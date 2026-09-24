package ch.gtko.aisloparena;

import android.content.Context;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.games.PlayGames;
import com.google.android.gms.games.PlayGamesSdk;

// Google Play Games Services v2 for src/playgames.js: sign-in and achievements.
// The ids come from res/values/games-ids.xml (the file Play Console gives, see play/README.md).
// While app_id is empty there, nothing is initialised and every call is a no-op.
@CapacitorPlugin(name = "PlayGames")
public class PlayGamesPlugin extends Plugin {
    private static final int RC_ACHIEVEMENTS = 9003;
    private boolean ready;

    @Override
    public void load() {
        ready = !res("app_id").isEmpty();
        // Starts the automatic sign-in: players signed in to Play Games need no button.
        if (ready) PlayGamesSdk.initialize(getContext());
    }

    // A string resource by name, "" when it is missing or blank.
    private String res(String name) {
        Context c = getContext();
        int id = c.getResources().getIdentifier(name, "string", c.getPackageName());
        return id == 0 ? "" : c.getString(id).trim();
    }

    private void signedIn(PluginCall call, boolean ok) {
        JSObject r = new JSObject();
        r.put("available", ready);
        r.put("signedIn", ok);
        call.resolve(r);
    }

    @PluginMethod
    public void info(PluginCall call) {
        if (!ready) { signedIn(call, false); return; }
        PlayGames.getGamesSignInClient(getActivity()).isAuthenticated()
            .addOnCompleteListener(t -> signedIn(call, t.isSuccessful() && t.getResult().isAuthenticated()));
    }

    // Explicit sign-in (the automatic one was declined or failed).
    @PluginMethod
    public void signIn(PluginCall call) {
        if (!ready) { signedIn(call, false); return; }
        PlayGames.getGamesSignInClient(getActivity()).signIn()
            .addOnCompleteListener(t -> signedIn(call, t.isSuccessful() && t.getResult().isAuthenticated()));
    }

    // { key }: resource name of the achievement id, e.g. achievement_first_blood.
    @PluginMethod
    public void unlock(PluginCall call) {
        String id = res(call.getString("key", ""));
        if (ready && !id.isEmpty()) PlayGames.getAchievementsClient(getActivity()).unlock(id);
        call.resolve();
    }

    // { key, steps }: incremental achievement progress, absolute (never goes down on Play's side).
    @PluginMethod
    public void setSteps(PluginCall call) {
        String id = res(call.getString("key", ""));
        int steps = call.getInt("steps", 0);
        if (ready && !id.isEmpty() && steps > 0) PlayGames.getAchievementsClient(getActivity()).setSteps(id, steps);
        call.resolve();
    }

    @PluginMethod
    public void showAchievements(PluginCall call) {
        if (!ready) { call.reject("Play Games is not set up"); return; }
        PlayGames.getAchievementsClient(getActivity()).getAchievementsIntent()
            .addOnSuccessListener(intent -> { getActivity().startActivityForResult(intent, RC_ACHIEVEMENTS); call.resolve(); })
            .addOnFailureListener(e -> call.reject(e.getMessage()));
    }
}
