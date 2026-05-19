import { createRemoteSttProvider } from './providers/remote-stt.provider.js';
import { createRemoteTtsProvider } from './providers/remote-tts.provider.js';
import { SpeechProviderRegistry } from './speech.registry.js';
import { SpeechRouter } from './speech.router.js';
import { SpeechService } from './speech.service.js';

export const serverSpeechProviderRegistry = new SpeechProviderRegistry();
serverSpeechProviderRegistry.register(createRemoteTtsProvider());
serverSpeechProviderRegistry.register(createRemoteSttProvider());

export const serverSpeechService = new SpeechService(new SpeechRouter(serverSpeechProviderRegistry));
