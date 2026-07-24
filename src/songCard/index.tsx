import { Box, Flex, Text, Image } from "@chakra-ui/react";
import { Track } from "@spotify/web-api-ts-sdk";
import { memo } from "react";

interface SongCardProps {
    song: Track
}

export const SongCard = memo((props : SongCardProps) => {
    const {song} = props;
    return (
        <Flex
            alignItems="center"
            backgroundColor="rgba(255, 255, 255, 0.02)"
            border="1px solid rgba(255, 255, 255, 0.05)"
            borderRadius="16px"
            p="12px 16px"
            gap="16px"
            transition="all 0.2s cubic-bezier(0.4, 0, 0.2, 1)"
            _hover={{
                backgroundColor: "rgba(255, 255, 255, 0.05)",
                borderColor: "rgba(255, 255, 255, 0.12)",
                transform: "translateY(-1px)"
            }}>
            <Image 
                src={song.album.images[0]?.url} 
                boxSize="48px" 
                borderRadius="8px"
                objectFit="cover"
                boxShadow="0 4px 12px rgba(0,0,0,0.3)"
            />
            <Box flex="1" textAlign="left" minWidth="0">
                <Text color="white" fontWeight="700" fontSize="0.95rem" noOfLines={1}>
                    {song.name}
                </Text>
                <Text color="#a7a7a7" fontWeight="500" fontSize="0.82rem" noOfLines={1} mt="2px">
                    {song.artists.map(a => a.name).join(", ")}
                </Text>
            </Box>
            <Text color="#6f6f76" fontSize="0.8rem" fontWeight="600" pr="4px" display={{ base: 'none', sm: 'block' }}>
                {song.album.release_date.split("-")[0]}
            </Text>
        </Flex>
    )
})