package work.jackfruiting.seshui;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register the native daemon bridge BEFORE the WebView loads, so window.SeshNative is
        // available when seshClient.js evaluates (see public/sesh-native-bridge.js).
        registerPlugin(SeshNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
