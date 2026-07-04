import {Box} from '@chakra-ui/react';
import {Surrealist} from '@frachter-app/surrealist';
import {
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
    >
      <DialogContent bg="gray.900" color="gray.100">
        <DialogHeader>
          <DialogTitle>Surrealist – {VOLUME}</DialogTitle>
        </DialogHeader>
        <DialogCloseTrigger />
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
