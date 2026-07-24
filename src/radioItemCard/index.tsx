import { Flex, Skeleton, Text } from "@chakra-ui/react";
import { RadioItem } from "../App";
import { memo } from "react";

export const RadioItemCard = memo(({ radioItem }: { radioItem: RadioItem }) => {
    return (
      <Skeleton isLoaded={radioItem.audio !== null && radioItem.audio !== 'empty'} borderRadius="16px">
        <Flex
          direction="column"
          background="linear-gradient(135deg, rgba(147, 51, 234, 0.08) 0%, rgba(79, 70, 229, 0.08) 100%)"
          border="1px solid rgba(147, 51, 234, 0.2)"
          borderRadius="16px"
          p="18px 20px"
          gap="8px"
          boxShadow="0 8px 24px rgba(147, 51, 234, 0.05)"
          textAlign="left"
          position="relative"
          _before={{
            content: '""',
            position: 'absolute',
            top: '0',
            left: '0',
            right: '0',
            height: '2px',
            background: 'linear-gradient(90deg, #9333ea, #4f46e5)',
            borderTopLeftRadius: '16px',
            borderTopRightRadius: '16px',
          }}>
          <Flex alignItems="center" gap="6px">
            <Text fontSize="0.95rem">🎙️</Text>
            <Text color="#a855f7" fontWeight="800" fontSize="0.72rem" textTransform="uppercase" letterSpacing="0.12em">
              AI Host transition
            </Text>
          </Flex>
          <Text color="#e2e8f0" fontSize="0.9rem" lineHeight="1.6" fontStyle="italic" fontWeight="500">
            "{radioItem.text}"
          </Text>
        </Flex>
      </Skeleton>
    );
  });