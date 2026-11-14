// -----------------------------------------------------------------------------
// The SDK handlers of the integration, registered before connect().
// -----------------------------------------------------------------------------

import { ACTIONS } from './constants.js';

export function registerHandlers(gladys, app, logger) {
  gladys.on('connected', () => {
    app.start().catch((err) => logger.error(`Start failed (${err?.name ?? 'Error'})`));
  });
  // A user enabled or disabled the integration, changed their country or
  // regions, or toggled one of their calendars.
  gladys.onCalendarAccountUpdated(async (userSelector) => {
    app.requestUser(userSelector);
  });
  gladys.onAction(ACTIONS.LIST_REGIONS, (fields) => app.listRegions(fields));
}
