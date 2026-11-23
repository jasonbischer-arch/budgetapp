import { Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, WebViewMessageEvent } from 'react-native-webview';

import {
  TELLER_SCRIPT,
  TellerConnectProps,
  tellerSetupOptions,
} from './teller-connect.shared';

// Teller has no React Native SDK, so on iPhone we host Teller Connect's web
// flow in a WebView and pass the result back with postMessage.
function html(enrollmentId?: string) {
  const opts = JSON.stringify(tellerSetupOptions(enrollmentId));
  return `<!doctype html>
<html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<style>html,body{margin:0;height:100%;background:#fff}</style>
<script src="${TELLER_SCRIPT}"></script>
</head><body>
<script>
  function send(type, payload) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: type, payload: payload }));
  }
  var opts = ${opts};
  opts.onSuccess = function (enrollment) { send('success', enrollment); };
  opts.onExit = function () { send('exit'); };
  opts.onFailure = function (failure) { send('failure', failure); };
  window.addEventListener('load', function () {
    if (!window.TellerConnect) { send('exit'); return; }
    TellerConnect.setup(opts).open();
  });
</script>
</body></html>`;
}

export default function TellerConnect({ enrollmentId, onSuccess, onExit }: TellerConnectProps) {
  const onMessage = (event: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === 'success') onSuccess(msg.payload);
      else onExit?.();
    } catch {
      onExit?.();
    }
  };

  return (
    <Modal animationType="slide" presentationStyle="pageSheet" onRequestClose={() => onExit?.()}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
        <WebView
          originWhitelist={['*']}
          source={{ html: html(enrollmentId), baseUrl: 'https://teller.io' }}
          onMessage={onMessage}
          javaScriptEnabled
          // Bank logins may open their own pages (MFA, OAuth); keep them inside.
          setSupportMultipleWindows={false}
        />
      </SafeAreaView>
    </Modal>
  );
}
