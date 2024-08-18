import { Card, CardBody, Heading, Stack, Text, Image } from "@chakra-ui/react";
import { Track } from "@spotify/web-api-ts-sdk";


interface SongCardProps {
    song: Track
}
export const SongCard = (props : SongCardProps) => {
    const {song} = props;

    const SongCard = () => {
        return (
            <Card direction={{ base: 'row', sm: 'row' }} size={'sm'}
                overflow='hidden'
                variant='outline'
                backgroundColor={"#2F2F2F"}
                textColor={"white"}
                borderWidth={0}>
                <Image src={song.album.images[0].url} maxWidth={'33%'} padding={2} borderRadius={10}/>
                <CardBody>

                    <Stack mt='6' spacing='3'>
                        <Heading size='md' textAlign={'left'}>{song.name}</Heading>
                        <div style={{display: 'flex', flexDirection: 'row'}}>
                            {
                                song.artists.map((artist) => (
                                    <Text key={artist.id}>{artist.name}</Text>
                                ))
                            }
                        </div>
                        
                    </Stack>
                </CardBody>
            </Card>
        )
    }

    return (
        <div>
            <SongCard />
        </div>
    )
}