import {useState} from 'react';
import {
  Badge,
  Box,
  HStack,
  IconButton,
  Spinner,
  Stack,
  Text,
} from '@chakra-ui/react';
import {LuDatabase, LuExternalLink} from 'react-icons/lu';
import {
  PopoverBody,
  PopoverContent,
  PopoverRoot,
  PopoverTitle,
  PopoverTrigger,
} from '../chakra-snippets/popover';
import {RadioGroup, Radio} from '../chakra-snippets/radio';
import {Switch} from '../chakra-snippets/switch';
import {Button} from '@chakra-ui/react';
import {useLautstaerkeCtx, type StorageBackend} from './context';
import {SurrealistModal} from './SurrealistModal';

// Floating storage-backend control for the noise monitor. Lets a crew member
// switch the READ source between the cloud Neon DB and a local SurrealDB volume
// on OPFS-VFS, toggle mirroring the live stream INTO that volume, and open an
// embedded Surrealist IDE to inspect it. Mirrors the BluetoothMenu's floating
// IconButton pattern; sits fixed at the bottom-right of the layout.
export function StorageMenu() {
  const {storage} = useLautstaerkeCtx();
  const [surrealistOpen, setSurrealistOpen] = useState(false);

  const onSurreal = storage.readSource === 'surreal';
  const statusColor =
    storage.status === 'ready'
      ? 'green'
      : storage.status === 'connecting'
        ? 'yellow'
        : storage.status === 'error'
          ? 'red'
          : 'gray';

  return (
    <>
      <Box position="fixed" bottom="4" right="4" zIndex="docked">
        <PopoverRoot positioning={{placement: 'top-end'}}>
          <PopoverTrigger asChild>
            <IconButton
              aria-label="Speicher-Backend"
              rounded="full"
              size="lg"
              shadow="md"
              // Blue while the local SurrealDB volume is the active source, to
              // signal you're off the cloud DB.
              colorPalette={onSurreal ? 'blue' : 'gray'}
              variant="solid"
            >
              <LuDatabase />
            </IconButton>
          </PopoverTrigger>
          <PopoverContent>
            <PopoverBody>
              <Stack gap="4">
                <PopoverTitle fontWeight="semibold">Datenquelle</PopoverTitle>

                <RadioGroup
                  value={storage.readSource}
                  onValueChange={(e) =>
                    storage.setReadSource(e.value as StorageBackend)
                  }
                  size="sm"
                >
                  <Stack gap="2">
                    <Radio value="neon">Neon (Cloud-Postgres)</Radio>
                    <Radio value="surreal">SurrealDB (lokal, OPFS-VFS)</Radio>
                  </Stack>
                </RadioGroup>

                <Box borderTopWidth="1px" borderColor="whiteAlpha.200" pt="3">
                  <Switch
                    checked={storage.surrealWrite}
                    onCheckedChange={(e) => storage.setSurrealWrite(e.checked)}
                    size="sm"
                  >
                    Live-Stream in SurrealDB mitschreiben
                  </Switch>
                  <Text fontSize="xs" color="gray.400" mt="1">
                    Schreibt die per MQTT/Bluetooth empfangenen Messwerte
                    zusätzlich in das lokale OPFS-Volume. Der Server schreibt
                    unabhängig davon weiter nach Neon.
                  </Text>
                </Box>

                <HStack justify="space-between">
                  <Text fontSize="sm" color="gray.400">
                    Lokale DB
                  </Text>
                  <HStack gap="2">
                    {storage.status === 'connecting' && <Spinner size="xs" />}
                    <Badge colorPalette={statusColor} size="sm">
                      {statusLabel(storage.status)}
                    </Badge>
                  </HStack>
                </HStack>
                {storage.error && (
                  <Text fontSize="xs" color="red.400">
                    {storage.error}
                  </Text>
                )}

                <Button
                  size="sm"
                  variant="outline"
                  disabled={storage.status !== 'ready'}
                  onClick={() => setSurrealistOpen(true)}
                >
                  <LuExternalLink />
                  Surrealist öffnen
                </Button>
              </Stack>
            </PopoverBody>
          </PopoverContent>
        </PopoverRoot>
      </Box>

      <SurrealistModal
        open={surrealistOpen}
        onClose={() => setSurrealistOpen(false)}
      />
    </>
  );
}

function statusLabel(status: string): string {
  switch (status) {
    case 'ready':
      return 'verbunden';
    case 'connecting':
      return 'verbinde…';
    case 'error':
      return 'Fehler';
    default:
      return 'aus';
  }
}
