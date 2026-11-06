import * as Sentry from '@sentry/node';
const defined = (attributes = {}) => Object.fromEntries(Object.entries(attributes).filter(([, value]) => value !== undefined));
export const log = {
    info: (message, attributes) => {
        Sentry.logger.info(message, defined(attributes));
        console.log(message, defined(attributes));
    },
    warn: (message, attributes) => {
        Sentry.logger.warn(message, defined(attributes));
        console.warn(message, defined(attributes));
    },
    error: (message, attributes) => {
        Sentry.logger.error(message, defined(attributes));
        console.error(message, defined(attributes));
    },
};
