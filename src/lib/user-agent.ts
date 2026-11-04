/**
 * Sent when a request doesn't set its own User-Agent. Node's fetch would send just "node", which device
 * detectors (Matomo DeviceDetector and its ports, e.g. DeviceDetector.NET) classify as a generic bot.
 * A named runtime token, like Postman's "PostmanRuntime/x", is not.
 */
export const DEFAULT_USER_AGENT = "ReqoraRuntime/1.0";
