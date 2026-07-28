import { Flex, Skeleton, Text } from "@chakra-ui/react";
import { RadioItem } from "../App";
import { memo } from "react";

export const RadioItemCard = memo(({ radioItem }: { radioItem: RadioItem }) => {
    const isAudioReady = radioItem.status === 'ready';
    return (
      <Flex
        direction="column"
        background="linear-gradient(135deg, rgba(147, 51, 234, 0.12) 0%, rgba(79, 70, 229, 0.12) 100%)"
        border="1px solid rgba(147, 51, 234, 0.3)"
        borderRadius="16px"
        p="18px 20px"
        gap="10px"
        boxShadow="0 8px 24px rgba(147, 51, 234, 0.08)"
        textAlign="left"
        position="relative"
        _before={{
          content: '""',
          position: 'absolute',
          top: '0',
          left: '0',
          right: '0',
          height: '3px',
          background: 'linear-gradient(90deg, #9333ea, #1DB954)',
          borderTopLeftRadius: '16px',
          borderTopRightRadius: '16px',
        }}>
        <Flex alignItems="center" justifyContent="space-between" width="100%">
          <Flex alignItems="center" gap="6px">
            <Text fontSize="0.95rem">🎙️</Text>
            <Text color="#a855f7" fontWeight="800" fontSize="0.75rem" textTransform="uppercase" letterSpacing="0.12em">
              AI Host Transition
            </Text>
          </Flex>
          <Skeleton isLoaded={true} borderRadius="full">
            <Text color={isAudioReady ? "#1DB954" : "#eab308"} fontSize="0.7rem" fontWeight="700">
              {isAudioReady ? "🔊 Voice Ready for Live Stream" : "⚡ Synthesizing AI DJ Speech..."}
            </Text>
          </Skeleton>
        </Flex>
        <Text color="#f1f5f9" fontSize="0.95rem" lineHeight="1.6" fontStyle="italic" fontWeight="500">
          "{radioItem.text}"
        </Text>
      </Flex>
    );
  });