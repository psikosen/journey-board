import { createLogger } from './logger.js';

const logger = createLogger('extension/lib/egressGuard.js', 'EgressGuard');

export function installEgressGuard(target) {
  const scope = target ?? globalThis;
  if (!scope) {
    logger.warn('installEgressGuard', 'init', 'No global scope available for egress guard installation');
    return;
  }

  if (scope.fetch) {
    const blockedFetch = async () => {
      const error = new Error('Network egress is disabled.');
      logger.error('fetch', 'egress', 'Blocked fetch invocation', { error, method: 'GET' });
      throw error;
    };
    Object.defineProperty(scope, 'fetch', {
      configurable: false,
      enumerable: true,
      writable: false,
      value: blockedFetch,
    });
  }

  if (scope.XMLHttpRequest) {
    const OriginalXHR = scope.XMLHttpRequest;
    function GuardedXHR() {
      logger.error('XMLHttpRequest', 'egress', 'Blocked XMLHttpRequest constructor');
      throw new Error('Network egress is disabled.');
    }
    GuardedXHR.prototype = OriginalXHR ? OriginalXHR.prototype : {};
    Object.defineProperty(scope, 'XMLHttpRequest', {
      configurable: false,
      enumerable: true,
      writable: false,
      value: GuardedXHR,
    });
  }

  logger.info('installEgressGuard', 'init', 'Egress guard installed successfully');
}
