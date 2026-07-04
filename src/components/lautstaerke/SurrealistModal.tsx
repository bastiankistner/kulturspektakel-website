import {Box} from '@chakra-ui/react';
import {Surrealist} from '@frachter-app/surrealist';
import {
  DialogBackdrop,
  DialogBody,
  DialogCloseTrigger,
  DialogContent,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from '../chakra-snippets/dialog';
import {VOLUME} from './surreal/db';

// Embedded Surrealist IDE (Query + Explorer) bound to the local opfs:// volume.
// The embed renders in an iframe served from public/surrealist-embed (staged
// from @frachter-app/surrealist by scripts/copy-surrealist-embed.js — see
// baseUrl); it joins the SAME coordinated engine as the app, so it attaches as a
// follower of whichever tab owns the volume — a live view of the shared DB, not
// a copy. The connection is locked (no connection editor inside the IDE).
export function SurrealistModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <DialogRoot
      open={open}
      onOpenChange={(e) => !e.open && onClose()}
      size="cover"
      placement="center"
      // The IDE lives in an <iframe>; clicking anything inside it (e.g. the
      // Explorer/Query switch) moves focus into that separate document, which
      // Chakra's dialog would otherwise treat as an "interact outside" and close
      // the modal. Disable outside-click dismissal — the modal is still closable
      // via Escape and the explicit close button.
      closeOnInteractOutside={false}
    >
      {/* Dim + blur the page behind the modal so the IDE reads as a focused
          overlay, not a bare panel. `backdrop={false}` on DialogContent below
          suppresses the snippet's default (unstyled) backdrop so we don't stack
          two. */}
      <DialogBackdrop bg="blackAlpha.700" backdropFilter="blur(6px)" />
      <DialogContent
        backdrop={false}
        bg="gray.900"
        color="gray.100"
        // A visible edge + soft drop shadow to lift the modal off the blurred
        // backdrop.
        borderWidth="1px"
        borderColor="whiteAlpha.300"
        rounded="lg"
        boxShadow="0 24px 64px rgba(0, 0, 0, 0.6)"
        overflow="hidden"
      >
        <DialogHeader>
          <DialogTitle>Surrealist – {VOLUME}</DialogTitle>
        </DialogHeader>
        {/* Force a light icon + subtle hover fill so the close button is legible
            on the dark header (the default ghost button renders a dark glyph). */}
        <DialogCloseTrigger
          color="whiteAlpha.800"
          _hover={{bg: 'whiteAlpha.200', color: 'white'}}
        />
        <DialogBody p="0" display="flex" flexDirection="column" minH="0">
          <Box flex="1" minH="0">
            {/* Only mount the iframe while open so it doesn't grab the volume in
                the background. */}
            {open && (
              <Surrealist
                baseUrl="/surrealist-embed"
                connection={{protocol: 'opfs', address: VOLUME}}
                views={['explorer', 'query']}
                theme="dark"
                style={{height: '100%', width: '100%', border: 'none'}}
              />
            )}
          </Box>
        </DialogBody>
      </DialogContent>
    </DialogRoot>
  );
}
