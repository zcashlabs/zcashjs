// Offline checks for @zcashlabs/zcash.js on React Native: the same API as Node and
// browsers, with the Zakura core running natively (no WebAssembly).
import { useEffect, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as zcash from '@zcashlabs/zcash.js';
import { checks } from './checks';

export default function App() {
  const [lines, setLines] = useState(['Running…']);
  useEffect(() => {
    const directory = decodeURI(FileSystem.documentDirectory.replace(/^file:\/\//, '')).replace(/\/$/, '');
    checks(zcash, directory, line => setLines(previous => [...previous, line]))
      .then(() => setLines(previous => [...previous, 'All checks passed']))
      .catch(error => setLines(previous => [...previous, `FAILED: ${error?.code ?? ''} ${error?.message ?? error}`]));
  }, []);
  return (
    <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 64 }}>
      {lines.map((line, index) => <Text key={index} testID={line === 'All checks passed' ? 'result' : undefined}>{line}</Text>)}
    </ScrollView>
  );
}
