import {useNavigate} from '@tanstack/react-router';
import {LuMic, LuMicOff} from 'react-icons/lu';
import {IconButton} from '@chakra-ui/react';
import {Tooltip} from '../chakra-snippets/tooltip';
import {MIC_DEVICE_NAME} from './microphone/source';
import {useLautstaerkeCtx} from './context';

// Local-microphone input source, alongside the Bluetooth control. Captures the
// browser mic and streams RELATIVE (uncalibrated) levels in as the virtual
// device MIC_DEVICE_NAME — a demo/fallback for when no hardware monitor is
// present. Starting it jumps to that device's live view.
export function MicrophoneButton() {
  const {microphone} = useLautstaerkeCtx();
  const navigate = useNavigate();

  if (!microphone.supported) return null;

  const toggle = async () => {
    if (microphone.active) {
      await microphone.stop();
      return;
    }
    try {
      await microphone.start();
      void navigate({
        to: '/crew/lautstaerke/$device',
        params: {device: MIC_DEVICE_NAME},
      });
    } catch {
      // start() already surfaces a toast on failure (except user-cancelled).
    }
  };

  return (
    <Tooltip
      content={
        microphone.active
          ? 'Mikrofon stoppen'
          : 'Lautstärke über das Mikrofon aufnehmen (unkalibriert, relativ)'
      }
    >
      <IconButton
        aria-label={microphone.active ? 'Mikrofon stoppen' : 'Mikrofon starten'}
        rounded="full"
        size="sm"
        flexShrink="0"
        loading={microphone.starting}
        colorPalette={microphone.active ? 'red' : 'gray'}
        variant={microphone.active ? 'solid' : 'outline'}
        onClick={() => void toggle()}
      >
        {microphone.active ? <LuMicOff /> : <LuMic />}
      </IconButton>
    </Tooltip>
  );
}
