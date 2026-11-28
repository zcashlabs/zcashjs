// Offline checks for @zcashlabs/zcash.js on React Native: the same API as Node and
// browsers, with the Zakura core running natively (no WebAssembly).
import { useEffect, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as zcash from '@zcashlabs/zcash.js';
import { checks } from './checks';

export default function App() {
  const [lines, setLines] = useState(['Running…']);
  const [result, setResult] = useState(undefined);
  useEffect(() => {
    const directory = decodeURI(FileSystem.documentDirectory.replace(/^file:\/\//, '')).replace(/\/$/, '');
    const add = line => {
      console.log(`[zcash-example] ${line}`);
      setLines(previous => [...previous, line]);
    };
    checks(zcash, directory, add)
      .then(() => setResult('All checks passed'))
      .catch(error => {
        const text = `FAILED: ${error?.code ?? ''} ${error?.message ?? error}`;
        console.log(`[zcash-example] ${text}\n${error?.stack ?? ''}`);
        setResult(text);
      });
  }, []);
  return (
    <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 64 }}>
      {lines.map((line, index) => <Text key={index}>{line}</Text>)}
      {result && <Text testID="result">{result}</Text>}
    </ScrollView>
  );
}
