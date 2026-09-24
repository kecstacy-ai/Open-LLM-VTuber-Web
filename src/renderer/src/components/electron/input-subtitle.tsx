import {
  LuSend, LuMic, LuMicOff, LuHand, LuX, LuMinus, LuMaximize2, LuMinimize2, LuAppWindow,
} from 'react-icons/lu';
import { usePetFullscreen } from '@/hooks/utils/use-pet-fullscreen';
import {
  Box,
  Button,
  Input,
  Stack,
  Text,
  VStack,
  IconButton,
} from '@chakra-ui/react';
import { useState, useEffect, useCallback } from 'react';
import { useInputSubtitle } from '@/hooks/electron/use-input-subtitle';
import { useDraggable } from '@/hooks/electron/use-draggable';
import { inputSubtitleStyles } from './electron-style';
import { useMode } from '@/context/mode-context';
import { useSubtitle } from '@/context/subtitle-context';

export function InputSubtitle() {
  const {
    inputValue,
    handleInputChange,
    handleKeyPress,
    handleCompositionStart,
    handleCompositionEnd,
    handleInterrupt,
    handleMicToggle,
    handleSend,
    lastAIMessage,
    hasAIMessages,
    aiState,
    micOn,
  } = useInputSubtitle();

  const { mode } = useMode();
  const isPet = mode === 'pet';
  const { showSubtitle } = useSubtitle();
  const petFullscreen = usePetFullscreen();

  const {
    elementRef,
    isDragging,
    handleMouseDown,
    handleMouseEnter,
    handleMouseLeave,
  } = useDraggable({
    componentId: 'input-subtitle',
  });

  const [isVisible, setIsVisible] = useState(true);

  const handleClose = useCallback(() => {
    if (isPet) {
      (window.api as any)?.updateComponentHover('input-subtitle', false);
    }
    setIsVisible(false);
  }, [isPet]);

  const handleOpen = () => {
    setIsVisible(true);
  };

  useEffect(() => {
    if (isPet) {
      const cleanup = (window.api as any)?.onToggleInputSubtitle(() => {
        if (isVisible) {
          handleClose();
        } else {
          handleOpen();
        }
      });
      return () => cleanup?.();
    }
    return () => {};
  }, [handleClose, isPet, isVisible]);

  useEffect(() => {
    (window as any).inputSubtitle = {
      open: handleOpen,
      close: handleClose,
    };

    return () => {
      delete (window as any).inputSubtitle;
    };
  }, [isPet, handleClose]);

  if (!isVisible) return null;

  return (
    <Box
      ref={elementRef}
      {...inputSubtitleStyles.container}
      {...inputSubtitleStyles.draggableContainer(isDragging)}
      onMouseDown={handleMouseDown}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Hide/show the whole bar: right-click her → Toggle InputBox and Subtitle */}
      <Box {...inputSubtitleStyles.box}>
        {isPet && (
          <Stack direction="row" gap="0" px="1.5" pt="1" justify="flex-end">
            <IconButton
              aria-label="Window mode"
              title="Back to window mode"
              onClick={() => (window.api as any)?.setMode?.('window')}
              {...inputSubtitleStyles.iconButton}
            >
              <LuAppWindow size={13} />
            </IconButton>
            <IconButton
              aria-label={petFullscreen ? 'Small window' : 'Fullscreen'}
              title={petFullscreen ? 'Small floating window' : 'Fullscreen'}
              onClick={() => (window as any).electron?.ipcRenderer.send('set-pet-fullscreen', !petFullscreen)}
              {...inputSubtitleStyles.iconButton}
            >
              {petFullscreen ? <LuMinimize2 size={13} /> : <LuMaximize2 size={13} />}
            </IconButton>
            <IconButton
              aria-label="Minimize"
              title="Minimize"
              onClick={() => (window as any).electron?.ipcRenderer.send('window-minimize')}
              {...inputSubtitleStyles.iconButton}
            >
              <LuMinus size={13} />
            </IconButton>
            <IconButton
              aria-label="Close"
              title="Close app"
              onClick={() => (window as any).electron?.ipcRenderer.send('window-close')}
              {...inputSubtitleStyles.iconButton}
              _hover={{ bg: 'red.500', color: 'white' }}
            >
              <LuX size={13} />
            </IconButton>
          </Stack>
        )}
        {showSubtitle && hasAIMessages && lastAIMessage && (
          <VStack {...inputSubtitleStyles.messageStack}>
            <Text {...inputSubtitleStyles.messageText}>
              {lastAIMessage}
            </Text>
          </VStack>
        )}

        <Box {...inputSubtitleStyles.inputBox}>
          <Stack direction="row" gap="1" p="1.5" align="center">
            <IconButton
              aria-label="Toggle microphone"
              title={`Mic ${micOn ? 'on' : 'off'} · ${aiState}`}
              onClick={handleMicToggle}
              {...inputSubtitleStyles.iconButton}
            >
              {micOn ? <LuMic size={14} /> : <LuMicOff size={14} />}
            </IconButton>
            <IconButton
              aria-label="Interrupt"
              title="Stop talking"
              onClick={handleInterrupt}
              {...inputSubtitleStyles.iconButton}
            >
              <LuHand size={14} />
            </IconButton>
            <Input
              value={inputValue}
              onChange={handleInputChange}
              onKeyDown={handleKeyPress}
              onCompositionStart={handleCompositionStart}
              onCompositionEnd={handleCompositionEnd}
              placeholder="Type…"
              {...inputSubtitleStyles.input}
            />
            <Button
              onClick={handleSend}
              {...inputSubtitleStyles.sendButton}
            >
              <LuSend size={14} />
            </Button>
          </Stack>
        </Box>
      </Box>
    </Box>
  );
}
