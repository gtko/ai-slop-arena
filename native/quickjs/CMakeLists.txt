# QuickJSVM GDExtension (see src/quickjs_vm.cpp and docs/local-sim.md).
# Sources of the two dependencies are not vendored: pass their checkouts.
#   git clone --depth 1 -b godot-4.4-stable https://github.com/godotengine/godot-cpp
#   git clone --depth 1 -b v0.17.0          https://github.com/quickjs-ng/quickjs
#   cmake -S native/quickjs -B build/qjs -G Ninja -DCMAKE_BUILD_TYPE=Release \
#         -DGODOT_CPP_DIR=<godot-cpp> -DQUICKJS_DIR=<quickjs> -DGODOTCPP_TARGET=template_release
#   cmake --build build/qjs
# Output: godot/addons/quickjs/bin/libquickjs.<platform>.<target>.<arch>.<dll|so|dylib>
# Android: add -DCMAKE_TOOLCHAIN_FILE=$NDK/build/cmake/android.toolchain.cmake -DANDROID_ABI=arm64-v8a
# (and armeabi-v7a) -DANDROID_PLATFORM=24. iOS: -DCMAKE_SYSTEM_NAME=iOS (static .xcframework).
cmake_minimum_required(VERSION 3.17)
project(godot_quickjs LANGUAGES C CXX)

set(GODOT_CPP_DIR "" CACHE PATH "godot-cpp checkout (godot-4.4-stable)")
set(QUICKJS_DIR "" CACHE PATH "quickjs-ng checkout (v0.17.0)")
set(GODOTCPP_TARGET "template_release" CACHE STRING "template_debug | template_release | editor")

set(CMAKE_POSITION_INDEPENDENT_CODE ON)
set(QJS_ENABLE_INSTALL OFF CACHE BOOL "" FORCE)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
add_subdirectory(${QUICKJS_DIR} quickjs EXCLUDE_FROM_ALL)
add_subdirectory(${GODOT_CPP_DIR} godot-cpp EXCLUDE_FROM_ALL)

add_library(quickjs_gd SHARED src/quickjs_vm.cpp)
target_link_libraries(quickjs_gd PRIVATE godot-cpp::${GODOTCPP_TARGET} qjs)
target_include_directories(quickjs_gd PRIVATE ${QUICKJS_DIR})
get_target_property(GODOTCPP_SUFFIX godot-cpp::${GODOTCPP_TARGET} GODOTCPP_SUFFIX)
set(OUT "${CMAKE_CURRENT_SOURCE_DIR}/../../godot/addons/quickjs/bin")
set_target_properties(quickjs_gd PROPERTIES
  CXX_STANDARD 17
  CXX_VISIBILITY_PRESET hidden
  PREFIX "lib"
  OUTPUT_NAME "quickjs${GODOTCPP_SUFFIX}"
  LIBRARY_OUTPUT_DIRECTORY "$<1:${OUT}>"
  RUNTIME_OUTPUT_DIRECTORY "$<1:${OUT}>"
  PDB_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/pdb"
)
if(MSVC)
  # static CRT: nothing to redistribute next to the game
  set_property(TARGET quickjs_gd qjs PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
endif()
