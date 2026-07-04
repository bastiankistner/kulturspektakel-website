import {Link} from '@tanstack/react-router';
import {Box, HStack, IconButton, Text, VStack} from '@chakra-ui/react';
import {LuMic, LuMicOff} from 'react-icons/lu';
import {Tooltip} from '../chakra-snippets/tooltip';
import {MIC_DEVICE_NAME} from './microphone/source';
import {decodeDb, isFresh, useLautstaerkeCtx, type DeviceState} from './context';

// The local microphone as a permanent entry in the device list. Unlike hardware
// monitors it's a VIRTUAL device: it only produces data while capturing. The row
// is always shown (so the mic is discoverable without a separate button) and
// carries its own inline record/stop control. While recording it links to the
// live view and shows the live level; stopped, it shows when it was last active.
export function MicrophoneRow({now}: {now: number}) {
  const {microphone, devices} = useLautstaerkeCtx();

  // Not supported (e.g. no getUserMedia / insecure context) → don't advertise it.
  if (!microphone.supported) return null;

  const state: DeviceState | undefined = devices[MIC_DEVICE_NAME];
  const active = microphone.active;
  const live = active && isFresh(state?.lastSeen, now);

  const toggle = (e: React.MouseEvent) => {
    // The control sits inside the row's <Link>; don't navigate when toggling.
    e.preventDefault();
    e.stopPropagation();
    if (active) {
      void microphone.stop();
    } else {
      void microphone.start().catch(() => {
        // start() toasts on real failures; user-cancel/denial is silent.
      });
    }
  };

  const control = (
    <Tooltip
      content={
        active
          ? 'Aufnahme stoppen'
          : 'Aufnahme starten (unkalibriert, relativ)'
      }
    >
      <IconButton
        aria-label={active ? 'Aufnahme stoppen' : 'Aufnahme starten'}
        rounded="full"
        size="sm"
        flexShrink="0"
        loading={microphone.starting}
        colorPalette={active ? 'red' : 'gray'}
        variant={active ? 'solid' : 'outline'}
        onClick={toggle}
      >
        {active ? <LuMicOff /> : <LuMic />}
      </IconButton>
    </Tooltip>
  );

  return (
    <Box
      asChild
      py="3"
      pl="4"
      pr="3"
      rounded="md"
      borderWidth="1px"
      borderColor="gray.700"
      _hover={{bg: 'gray.800'}}
    >
      <Link to="/crew/lautstaerke/$device" params={{device: MIC_DEVICE_NAME}}>
        <HStack>
          <Box
            w="3"
            h="3"
            mr="2"
            rounded="full"
            flexShrink="0"
            // Red while recording, grey when idle.
            bg={active ? 'red.500' : 'gray.500'}
          />
          <VStack align="start" gap="0" flex="1" minW="0">
            <Text fontWeight="bold" truncate w="full">
              Mikrofon (lokal)
            </Text>
            <Text
              fontFamily="mono"
              fontSize="xs"
              color="gray.500"
              lineHeight="1"
              truncate
              minW="0"
            >
              {MIC_DEVICE_NAME} · relativ
            </Text>
          </VStack>

          <VStack gap="1" align="end" minW="0" mr="1">
            {live ? (
              <Text fontFamily="mono" fontWeight="bold" lineHeight="1">
                {decodeDb(state!.latest.laeq1s).toFixed(1)} dB(A)
              </Text>
            ) : active ? (
              <Text fontFamily="mono" fontSize="xs" color="gray.500" lineHeight="1">
                startet…
              </Text>
            ) : (
              <Text fontFamily="mono" fontSize="xs" color="gray.500" lineHeight="1">
                aus
              </Text>
            )}
          </VStack>

          {control}
        </HStack>
      </Link>
    </Box>
  );
}
