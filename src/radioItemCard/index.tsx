import { memo } from "react";
import { RadioItem } from "../App";
import { Card, CardBody, Skeleton, Text } from "@chakra-ui/react";

export const RadioItemCard = memo(({ radioItem }: { radioItem: RadioItem }) => {
    return (
      <Card direction={{ base: 'row', sm: 'row' }} size={'sm'} key={radioItem.beforeTrackId + "radio"}
        overflow='hidden'
        variant='outline'
        backgroundColor={"#2F2F2F"}
        textColor={"white"}
        borderWidth={0}>
        <Skeleton isLoaded={radioItem.audio != null && radioItem.audio != 'empty'}>
          <CardBody backgroundColor={'purple'}>
            <Text>{radioItem.text}</Text>
          </CardBody>
        </Skeleton>
      </Card>
    );
  });