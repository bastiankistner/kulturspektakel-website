import {createFileRoute} from '@tanstack/react-router';
import {useEffect, useRef, useState} from 'react';
import {
  Box,
  Button,
  ChakraProvider,
  defaultSystem,
  HStack,
  Heading,
  Stack,
  Text,
} from '@chakra-ui/react';
import {BAND_FREQUENCIES} from '../components/lautstaerke/bluetooth';
import {decodeDb} from '../components/lautstaerke/context';
import {
  isMicrophoneSupported,
  startMicrophone,
  type MicHandle,
} from '../components/lautstaerke/microphone/source';
import type {NoiseRecording} from '../proto/noise';

// TEMPORARY dev-only harness for the local-microphone noise source. Unlike
// /crew/lautstaerke this route has NO crew auth, so the mic capture + DSP can be
// exercised interactively (permission prompt, live band levels) without a
// Directus session. Remove before public launch — it is not linked anywhere.
export const Route = createFileRoute('/lautstaerke-mic-test')({
  component: MicTest,
});

const fmtHz = (f: number) =>
  f >= 1000 ? `${(f / 1000).toLocaleString('de-DE')}k` : `${f}`;

function MicTest() {
  const [supported, setSupported] = useState(false);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [frame, setFrame] = useState<NoiseRecording | null>(null);
  const handleRef = useRef<MicHandle | null>(null);

  useEffect(() => {
    setSupported(isMicrophoneSupported());
    return () => {
      void handleRef.current?.stop();
    };
  }, []);

  const start = async () => {
    setError(null);
    try {
      handleRef.current = await startMicrophone((f) => setFrame(f));
      setActive(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const stop = async () => {
    await handleRef.current?.stop();
    handleRef.current = null;
    setActive(false);
  };

  const record = frame?.records[0];

  return (
    // This route has no layout parent, so it provides its own ChakraProvider
    // (like crew.tsx) — otherwise SSR errors and falls back to client rendering.
    <ChakraProvider value={defaultSystem}>
    <Box bg="gray.900" color="gray.100" minH="100vh" p="6">
      <Stack gap="4" maxW="4xl" mx="auto">
        <Heading size="lg">Mikrofon-Test (dev)</Heading>
        <Text fontSize="sm" color="yellow.300">
          Temporäre, ungeschützte Testseite. Werte sind relativ und
          unkalibriert (kein echter Schalldruckpegel).
        </Text>

        {!supported ? (
          <Text color="red.400">
            Web Audio / getUserMedia wird hier nicht unterstützt.
          </Text>
        ) : (
          <HStack>
            <Button
              colorPalette={active ? 'red' : 'green'}
              onClick={() => void (active ? stop() : start())}
            >
              {active ? 'Mikrofon stoppen' : 'Mikrofon starten'}
            </Button>
            {record && (
              <Text fontFamily="mono">
                LAeq {decodeDb(record.laeq1s).toFixed(1)} dB · LCeq{' '}
                {decodeDb(record.lceq1s).toFixed(1)} dB · Peak{' '}
                {decodeDb(record.lcpeak1s).toFixed(1)} dB
              </Text>
            )}
          </HStack>
        )}

        {error && <Text color="red.400">{error}</Text>}

        {record && (
          <Box>
            <Text fontSize="sm" color="gray.400" mb="2">
              1/3-Oktav-Bänder (relativ):
            </Text>
            <HStack align="flex-end" gap="1" h="240px">
              {Array.from(record.bands, (byte, i) => {
                const db = decodeDb(byte);
                const h = Math.max(0, Math.min(100, ((db - 20) / 90) * 100));
                return (
                  <Stack key={i} align="center" gap="1" flex="1" h="100%">
                    <Box flex="1" display="flex" alignItems="flex-end" w="100%">
                      <Box
                        w="100%"
                        h={`${h}%`}
                        bg="yellow.400"
                        rounded="sm"
                        transition="height 120ms linear"
                      />
                    </Box>
                    <Text
                      fontSize="2xs"
                      color="gray.500"
                      transform="rotate(-45deg)"
                      whiteSpace="nowrap"
                    >
                      {fmtHz(BAND_FREQUENCIES[i])}
                    </Text>
                  </Stack>
                );
              })}
            </HStack>
          </Box>
        )}
      </Stack>
    </Box>
    </ChakraProvider>
  );
}
