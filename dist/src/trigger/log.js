import * as Sentry from "@sentry/node";
import { logger } from "@trigger.dev/sdk";
// Structured logs for tasks: sent to Sentry Logs, where init.ts attaches the run's task, run id and
// environment to every entry, and to the Trigger.dev run log. Same attribute rules as ../log.ts:
// ids, statuses and counts only, never message text, secrets or platform handles
const defined = (attributes = {}) => Object.fromEntries(Object.entries(attributes).filter(([, value]) => value !== undefined));
export const log = {
    info: (message, attributes) => {
        Sentry.logger.info(message, defined(attributes));
        logger.info(message, defined(attributes));
    },
    warn: (message, attributes) => {
        Sentry.logger.warn(message, defined(attributes));
        logger.warn(message, defined(attributes));
    },
    error: (message, attributes) => {
        Sentry.logger.error(message, defined(attributes));
        logger.error(message, defined(attributes));
    },
};
