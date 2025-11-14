import { createLogger } from './logger.js';

const logger = createLogger('extension/lib/scribe.js', 'ScribeLLM');

function formatEvent(event) {
  switch (event.type) {
    case 'click':
      return `clicked ${event.text || event.selector || 'an element'}`;
    case 'input':
      return `entered data into ${event.text || event.selector || 'a field'}`;
    case 'route':
      return `navigated to ${event.route || 'a new page'}`;
    case 'ocr':
      return `saw text "${event.text}"`;
    case 'observation':
      if (event.signals?.motion && event.signals.motion.avg > 0.4) {
        return 'screen changed significantly';
      }
      return 'captured a frame';
    default:
      return event.type;
  }
}

export class ScribeLLM {
  constructor(options = {}) {
    this.maxTokens = options.maxTokens ?? 2048;
    this.chunkSize = options.chunkSize ?? 120;
    this.windowMs = options.windowMs ?? 30000;
    this.buffer = [];
    this.lastFlushedAt = 0;
  }

  addEvents(events) {
    this.buffer.push(...events);
  }

  #tokenize(sentence) {
    return sentence.split(/\s+/).filter(Boolean);
  }

  #buildSentence(event) {
    const timestamp = new Date(event.start ?? event.t ?? Date.now()).toISOString();
    return `${timestamp}: ${formatEvent(event)}`;
  }

  *stream(now = Date.now()) {
    this.buffer = this.buffer.filter((event) => (event.end ?? event.t ?? 0) >= now - this.windowMs);
    const tokens = [];
    for (const event of this.buffer) {
      const sentence = this.#buildSentence(event);
      const sentenceTokens = this.#tokenize(sentence);
      if (tokens.length + sentenceTokens.length > this.maxTokens) {
        logger.warn('stream', 'scribe', 'Token budget exceeded, truncating output');
        break;
      }
      tokens.push(...sentenceTokens);
      while (tokens.length >= this.chunkSize) {
        yield tokens.splice(0, this.chunkSize).join(' ');
      }
    }
    if (tokens.length) {
      yield tokens.splice(0, tokens.length).join(' ');
    }
    this.lastFlushedAt = now;
  }

  summarize(now = Date.now()) {
    const chunks = Array.from(this.stream(now));
    return chunks.join('\n');
  }
}

