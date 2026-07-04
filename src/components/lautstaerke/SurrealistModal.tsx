import {useEffect, useState, type ComponentType} from 'react';
import {Box, Code, Spinner, Stack, Text} from '@chakra-ui/react';
import {
  DialogBody,
  DialogCloseTrigger,
  DialogContent,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from '../chakra-snippets/dialog';
import {VOLUME} from './surreal/db';

// Props of the @frachter-app/surrealist embed we rely on (a subset). Kept local
// so this file has no hard type dependency on the (optional) package.
type SurrealistProps = {
  connection: {protocol: 'opfs' | 'indxdb' | 'mem'; address: string};
  views?: Array<'explorer' | 'query'>;
  theme?: 'dark' | 'light';
  style?: React.CSSProperties;
};
type SurrealistComponent = ComponentType<SurrealistProps>;

// The Surrealist embed (`@frachter-app/surrealist`) is an OPTIONAL dependency: it
// lives in a separate fork repo and is a pre-release on GitHub Packages, so it is
// loaded LAZILY via dynamic import rather than bundled. When present, it renders
// the real IDE (an iframe that joins the coordinated opfs:// volume as a
// follower — a live view of the same DB). When absent, the modal explains how to
// enable it. This keeps `yarn install` working without access to that package
// while making it a drop-in once installed.
let cached: SurrealistComponent | null | undefined;

function useSurrealistEmbed(enabled: boolean): {
  Component: SurrealistComponent | null;
  loading: boolean;
} {
  const [Component, setComponent] = useState<SurrealistComponent | null>(
    cached ?? null,
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || cached !== undefined) {
      setComponent(cached ?? null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    // Vite: keep this out of the dep graph unless the package is installed.
    import(/* @vite-ignore */ '@frachter-app/surrealist')
      .then((mod) => {
        cached = (mod.Surrealist ?? null) as SurrealistComponent | null;
        if (!cancelled) setComponent(cached);
      })
      .catch(() => {
        cached = null;
        if (!cancelled) setComponent(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return {Component, loading};
}

export function SurrealistModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const {Component, loading} = useSurrealistEmbed(open);

  return (
    <DialogRoot
      open={open}
      onOpenChange={(e) => !e.open && onClose()}
      size="cover"
      placement="center"
    >
      <DialogContent bg="gray.900" color="gray.100">
        <DialogHeader>
          <DialogTitle>Surrealist – {VOLUME}</DialogTitle>
        </DialogHeader>
        <DialogCloseTrigger />
        <DialogBody p="0" display="flex" flexDirection="column" minH="0">
          {loading ? (
            <Box flex="1" display="grid" placeItems="center">
              <Spinner />
            </Box>
          ) : Component ? (
            <Box flex="1" minH="0">
              <Component
                connection={{protocol: 'opfs', address: VOLUME}}
                views={['explorer', 'query']}
                theme="dark"
                style={{height: '100%', width: '100%', border: 'none'}}
              />
            </Box>
          ) : (
            <UnavailableNotice />
          )}
        </DialogBody>
      </DialogContent>
    </DialogRoot>
  );
}

function UnavailableNotice() {
  return (
    <Box p="6">
      <Stack gap="3" maxW="2xl">
        <Text fontWeight="semibold">Surrealist ist noch nicht eingebunden.</Text>
        <Text fontSize="sm" color="gray.400">
          Die eingebettete Surrealist-IDE wird als optionales Paket geladen. Um
          sie zu aktivieren, das Paket installieren und die statischen Assets
          bereitstellen:
        </Text>
        <Code
          display="block"
          whiteSpace="pre"
          p="3"
          fontSize="xs"
          colorPalette="gray"
        >
          {[
            'yarn add @frachter-app/surrealist@0.1.0-fr.12',
            'cp -R node_modules/@frachter-app/surrealist/dist/embed-assets \\',
            '      public/surrealist-embed',
          ].join('\n')}
        </Code>
        <Text fontSize="sm" color="gray.400">
          Danach verbindet sich Surrealist als Follower mit dem lokalen
          OPFS-Volume <Code>opfs://{VOLUME}</Code> – eine Live-Ansicht derselben
          Datenbank.
        </Text>
      </Stack>
    </Box>
  );
}
