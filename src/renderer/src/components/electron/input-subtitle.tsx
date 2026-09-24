import {
  LuSend, LuMic, LuMicOff, LuHand,
} from 'react-icons/lu';
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
