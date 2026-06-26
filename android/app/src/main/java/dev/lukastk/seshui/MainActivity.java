package dev.lukastk.seshui;

import android.os.Bundle;
import android.util.Log;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register the native daemon bridge BEFORE the WebView loads, so window.SeshNative is
        // available when seshClient.js evaluates (see public/sesh-native-bridge.js).
        registerPlugin(SeshNativePlugin.class);
        super.onCreate(savedInstanceState);

        // Survive a WebView renderer-process kill instead of crashing the whole app.
        //
        // Android runs the WebView's rendering in a SEPARATE process. When that process dies —
        // almost always reclaimed under memory pressure (transcript view is the app's heaviest
        // WebView consumer: large Markdown DOM that grows as you scroll history) — the framework
        // calls onRenderProcessGone. Per Android's contract, if NO WebViewClient handles it
        // (returns false), the system kills our entire app process alongside the dead renderer.
        // That is the "app keeps crashing in transcript view" report.
        //
        // Capacitor's BridgeWebViewClient delegates this to registered WebViewListeners and returns
        // false unless one returns true. So we register one: recreate the Activity (rebuilds a
        // fresh WebView from the start URL) and return true — the app reloads instead of dying.
        // The cost is losing the current view/scroll position; far better than a hard crash.
        getBridge()
            .addWebViewListener(
                new WebViewListener() {
                    @Override
                    public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                        Log.e(
                            "SeshUI",
                            "WebView renderer process gone (didCrash=" + detail.didCrash() + "); recreating activity to recover"
                        );
                        runOnUiThread(() -> recreate());
                        return true; // handled — do NOT let the OS kill the app
                    }
                }
            );
    }
}
