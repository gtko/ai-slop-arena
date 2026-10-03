// QuickJSVM: a minimal GDExtension that embeds QuickJS-ng (MIT) in Godot 4.4, so the native builds
// can run the game rules bundle (godot/local/sim_local.js) for offline solo and the training dojo.
// GDScript side: godot/scripts/local_room.gd. Only strings, numbers, booleans and null cross the
// boundary (the local room speaks JSON strings), objects come back as JSON text.
//
//   var vm := ClassDB.instantiate("QuickJSVM")
//   vm.eval(source, "sim_local.js")          -> last value (or null + get_error())
//   vm.call_function("SlopLocal.poll", [id, dt])
//   vm.memory_bytes(), vm.run_gc()

#include <godot_cpp/classes/ref_counted.hpp>
#include <godot_cpp/core/class_db.hpp>
#include <godot_cpp/godot.hpp>
#include <godot_cpp/variant/utility_functions.hpp>

#include <gdextension_interface.h>

extern "C" {
#include "quickjs.h"
}

using namespace godot;

class QuickJSVM : public RefCounted {
	GDCLASS(QuickJSVM, RefCounted)

	JSRuntime *rt = nullptr;
	JSContext *ctx = nullptr;
	String error;

	static JSValue js_print(JSContext *c, JSValueConst, int argc, JSValueConst *argv) {
		String line;
		for (int i = 0; i < argc; i++) {
			const char *s = JS_ToCString(c, argv[i]);
			if (i) line += " ";
			line += String::utf8(s ? s : "");
			if (s) JS_FreeCString(c, s);
		}
		UtilityFunctions::print(line);
		return JS_UNDEFINED;
	}

	void take_error() {
		JSValue ex = JS_GetException(ctx);
		const char *s = JS_ToCString(ctx, ex);
		error = String::utf8(s ? s : "error");
		if (s) JS_FreeCString(ctx, s);
		JSValue stack = JS_GetPropertyStr(ctx, ex, "stack");
		if (JS_IsString(stack)) {
			const char *st = JS_ToCString(ctx, stack);
			if (st) { error += "\n" + String::utf8(st); JS_FreeCString(ctx, st); }
		}
		JS_FreeValue(ctx, stack);
		JS_FreeValue(ctx, ex);
	}

	Variant to_variant(JSValueConst v) {
		if (JS_IsBool(v)) return (bool)JS_ToBool(ctx, v);
		if (JS_IsNumber(v)) {
			double d = 0;
			JS_ToFloat64(ctx, &d, v);
			return d;
		}
		if (JS_IsString(v)) {
			size_t len = 0;
			const char *s = JS_ToCStringLen(ctx, &len, v);
			String out = String::utf8(s, (int)len);
			JS_FreeCString(ctx, s);
			return out;
		}
		if (JS_IsNull(v) || JS_IsUndefined(v)) return Variant();
		JSValue json = JS_JSONStringify(ctx, v, JS_UNDEFINED, JS_UNDEFINED);
		Variant out = JS_IsString(json) ? to_variant(json) : Variant();
		JS_FreeValue(ctx, json);
		return out;
	}

	JSValue to_js(const Variant &v) {
		switch (v.get_type()) {
			case Variant::BOOL: return JS_NewBool(ctx, (bool)v);
			case Variant::INT: return JS_NewInt64(ctx, (int64_t)v);
			case Variant::FLOAT: return JS_NewFloat64(ctx, (double)v);
			case Variant::STRING:
			case Variant::STRING_NAME: {
				CharString u = String(v).utf8();
				return JS_NewStringLen(ctx, u.get_data(), u.length());
			}
			default: return JS_NULL;
		}
	}

protected:
	static void _bind_methods() {
		ClassDB::bind_method(D_METHOD("eval", "code", "filename"), &QuickJSVM::eval, DEFVAL("<eval>"));
		ClassDB::bind_method(D_METHOD("call_function", "path", "args"), &QuickJSVM::call_function, DEFVAL(Array()));
		ClassDB::bind_method(D_METHOD("get_error"), &QuickJSVM::get_error);
		ClassDB::bind_method(D_METHOD("memory_bytes"), &QuickJSVM::memory_bytes);
		ClassDB::bind_method(D_METHOD("run_gc"), &QuickJSVM::run_gc);
		ClassDB::bind_method(D_METHOD("engine_version"), &QuickJSVM::engine_version);
	}

public:
	QuickJSVM() {
		rt = JS_NewRuntime();
		JS_SetMaxStackSize(rt, 1024 * 1024);
		ctx = JS_NewContext(rt);
		JSValue global = JS_GetGlobalObject(ctx);
		JS_SetPropertyStr(ctx, global, "__godot_print", JS_NewCFunction(ctx, js_print, "__godot_print", 1));
		JS_FreeValue(ctx, global);
		const char *prelude =
			"globalThis.console = { log: __godot_print, info: __godot_print, debug: () => {},"
			" warn: (...a) => __godot_print('[js warn]', ...a), error: (...a) => __godot_print('[js error]', ...a) };";
		JSValue r = JS_Eval(ctx, prelude, strlen(prelude), "<prelude>", JS_EVAL_TYPE_GLOBAL);
		JS_FreeValue(ctx, r);
	}

	~QuickJSVM() {
		if (ctx) JS_FreeContext(ctx);
		if (rt) JS_FreeRuntime(rt);
	}

	Variant eval(const String &code, const String &filename) {
		error = "";
		CharString src = code.utf8();
		CharString fn = filename.utf8();
		JSValue r = JS_Eval(ctx, src.get_data(), src.length(), fn.get_data(), JS_EVAL_TYPE_GLOBAL);
		if (JS_IsException(r)) {
			take_error();
			return Variant();
		}
		Variant out = to_variant(r);
		JS_FreeValue(ctx, r);
		return out;
	}

	// path: a dotted name from the global object ("SlopLocal.poll"); `this` is its parent object.
	Variant call_function(const String &path, const Array &args) {
		error = "";
		PackedStringArray parts = path.split(".");
		JSValue self = JS_GetGlobalObject(ctx);
		JSValue fn = JS_DupValue(ctx, self);
		for (int i = 0; i < parts.size(); i++) {
			JS_FreeValue(ctx, self);
			self = fn;
			CharString key = parts[i].utf8();
			fn = JS_GetPropertyStr(ctx, self, key.get_data());
		}
		if (!JS_IsFunction(ctx, fn)) {
			error = "not a function: " + path;
			JS_FreeValue(ctx, fn);
			JS_FreeValue(ctx, self);
			return Variant();
		}
		JSValue argv[8];
		int argc = MIN((int)args.size(), 8);
		for (int i = 0; i < argc; i++) argv[i] = to_js(args[i]);
		JSValue r = JS_Call(ctx, fn, self, argc, argv);
		for (int i = 0; i < argc; i++) JS_FreeValue(ctx, argv[i]);
		JS_FreeValue(ctx, fn);
		JS_FreeValue(ctx, self);
		if (JS_IsException(r)) {
			take_error();
			return Variant();
		}
		Variant out = to_variant(r);
		JS_FreeValue(ctx, r);
		return out;
	}

	String get_error() const { return error; }

	int64_t memory_bytes() {
		JSMemoryUsage u;
		JS_ComputeMemoryUsage(rt, &u);
		return u.malloc_size;
	}

	void run_gc() { JS_RunGC(rt); }

	String engine_version() const { return String("QuickJS-ng ") + String(JS_GetVersion()); }
};

static void initialize_quickjs_module(ModuleInitializationLevel p_level) {
	if (p_level != MODULE_INITIALIZATION_LEVEL_SCENE) return;
	GDREGISTER_CLASS(QuickJSVM);
}

static void uninitialize_quickjs_module(ModuleInitializationLevel) {}

extern "C" {
GDExtensionBool GDE_EXPORT quickjs_library_init(GDExtensionInterfaceGetProcAddress p_get_proc_address, GDExtensionClassLibraryPtr p_library, GDExtensionInitialization *r_initialization) {
	godot::GDExtensionBinding::InitObject init_obj(p_get_proc_address, p_library, r_initialization);
	init_obj.register_initializer(initialize_quickjs_module);
	init_obj.register_terminator(uninitialize_quickjs_module);
	init_obj.set_minimum_library_initialization_level(MODULE_INITIALIZATION_LEVEL_SCENE);
	return init_obj.init();
}
}
