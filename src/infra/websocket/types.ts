/** The server and token a socket connects with. */
export type ChannelTarget = { endpoint: string; token: string };

/** A `paths` item sent as an object, which may carry more fields later. */
export type PathItem = { path?: unknown };
