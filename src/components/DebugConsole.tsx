import React, { useState, useEffect } from 'react';
import { Box, Button, Flex, Text, VStack } from '@chakra-ui/react';

export interface LogEntry {
  id: string;
  time: string;
  type: 'info' | 'warn' | 'error' | 'event';
  message: string;
}

// Simple global logger for web mobile debugging
export const logger = {
  listeners: new Set<(logs: LogEntry[]) => void>(),
  logs: [] as LogEntry[],
  
  add(type: 'info' | 'warn' | 'error' | 'event', message: string) {
    const entry: LogEntry = {
      id: Math.random().toString(36).substring(2, 9),
      time: new Date().toLocaleTimeString(),
      type,
      message
    };
    this.logs = [entry, ...this.logs].slice(0, 80); // keep last 80 logs
    this.listeners.forEach(cb => cb(this.logs));
  },
  
  subscribe(cb: (logs: LogEntry[]) => void) {
    this.listeners.add(cb);
    cb(this.logs);
    return () => { this.listeners.delete(cb); };
  },
  
  clear() {
    this.logs = [];
    this.listeners.forEach(cb => cb(this.logs));
  }
};

// Global console & error interception for mobile FE debugging
if (typeof window !== 'undefined') {
  const origLog = console.log;
  const origWarn = console.warn;
  const origErr = console.error;

  console.log = (...args: any[]) => {
    origLog(...args);
    const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    logger.add('info', msg);
  };

  console.warn = (...args: any[]) => {
    origWarn(...args);
    const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    logger.add('warn', msg);
  };

  console.error = (...args: any[]) => {
    origErr(...args);
    const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    logger.add('error', msg);
  };

  window.addEventListener('error', (event) => {
    logger.add('error', `[UNCAUGHT ERROR] ${event.message} at ${event.filename}:${event.lineno}`);
  });

  window.addEventListener('unhandledrejection', (event) => {
    logger.add('error', `[UNHANDLED REJECTION] ${event.reason?.message || event.reason}`);
  });
}

export const DebugConsole: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  useEffect(() => {
    return logger.subscribe(setLogs);
  }, []);

  return (
    <Box position="fixed" bottom="12px" right="12px" zIndex="999999">
      {!isOpen ? (
        <Button
          size="xs"
          backgroundColor="rgba(0,0,0,0.8)"
          color="#1DB954"
          border="1px solid #1DB954"
          borderRadius="full"
          px="12px"
          py="6px"
          fontSize="0.75rem"
          fontWeight="800"
          boxShadow="0 4px 14px rgba(0,0,0,0.6)"
          onClick={() => setIsOpen(true)}>
          🐛 Logs ({logs.length})
        </Button>
      ) : (
        <Box
          width="calc(100vw - 24px)"
          maxWidth="380px"
          maxHeight="320px"
          backgroundColor="rgba(10, 10, 14, 0.95)"
          border="1px solid rgba(255,255,255,0.15)"
          borderRadius="16px"
          boxShadow="0 12px 32px rgba(0,0,0,0.8)"
          p="12px"
          backdropFilter="blur(16px)">
          <Flex justify="space-between" align="center" mb="8px" borderBottom="1px solid rgba(255,255,255,0.1)" pb="6px">
            <Text color="#1DB954" fontWeight="800" fontSize="0.8rem">
              📱 Mobile Debug Console ({logs.length})
            </Text>
            <Flex gap="6px">
              <Button size="xs" colorScheme="gray" variant="ghost" height="20px" fontSize="0.65rem" onClick={() => logger.clear()}>
                Clear
              </Button>
              <Button size="xs" colorScheme="red" variant="ghost" height="20px" fontSize="0.65rem" onClick={() => setIsOpen(false)}>
                Close
              </Button>
            </Flex>
          </Flex>

          <VStack align="stretch" spacing="4px" overflowY="auto" maxHeight="240px" pr="4px">
            {logs.length === 0 ? (
              <Text color="#666" fontSize="0.75rem" textAlign="center" py="16px">
                No logs recorded yet...
              </Text>
            ) : (
              logs.map(log => {
                const color = 
                  log.type === 'error' ? '#ff6b6b' :
                  log.type === 'warn' ? '#ffd166' :
                  log.type === 'event' ? '#06d6a0' : '#4cc9f0';
                return (
                  <Box key={log.id} fontSize="0.7rem" fontFamily="monospace" p="4px 6px" background="rgba(255,255,255,0.03)" borderRadius="4px">
                    <Text as="span" color="#888" mr="6px">[{log.time}]</Text>
                    <Text as="span" color={color} fontWeight="bold" mr="6px">[{log.type.toUpperCase()}]</Text>
                    <Text as="span" color="#eee">{log.message}</Text>
                  </Box>
                );
              })
            )}
          </VStack>
        </Box>
      )}
    </Box>
  );
};
