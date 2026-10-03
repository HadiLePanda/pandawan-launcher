/**
 * Channel -> colour, in one place.
 *
 * A channel is shown in the catalog table, the game rail and the game header.
 * With the class list hand-written at each call site there were three chances
 * for alpha to be violet in one place and something else in another, and that
 * drift is invisible until someone notices the same channel wearing two colours
 * on one screen. Nobody hand-writes a colour here any more.
 *
 * It lives outside ui.tsx for the same reason cx.ts does:
 * eslint-plugin-react-refresh warns on any file exporting both components and
 * plain functions, because HMR can only invalidate a module cleanly when every
 * export is a component. These are all plain functions, so they belong in a
 * module of their own.
 *
 * The hue values live in styles.css as --color-channel-*, and every one of them
 * is measured rather than chosen by eye.
 */

/**
 * The class list per tone key, so a Badge (`tone={channelTone(x)}`) and a plain
 * chip (`className={channelToneClasses(x)}`) resolve to the SAME classes.
 *
 * They are registered as tone keys rather than returned loose because a Badge
 * applies its default tone and then the className on top: passing these as
 * className would leave the badge with two conflicting border colours, resolved
 * by stylesheet order rather than by anything a reader of the code can predict.
 */
const TONE: Record<string, string> = {
  stable: 'border-channel-stable/45 text-channel-stable bg-channel-stable/10',
  beta: 'border-channel-beta/45 text-channel-beta bg-channel-beta/10',
  alpha: 'border-channel-alpha/45 text-channel-alpha bg-channel-alpha/10',
  /* Deliberately no hue of its own - see channelTone below. */
  unknown: 'border-border text-ink-muted bg-surface-light',
};

/**
 * An explicit key list rather than a lookup against TONE, so this can never
 * grow a colour for something that is not a channel.
 */
const CHANNEL_KEYS = new Set(['stable', 'beta', 'alpha']);

/**
 * The tone key for a channel string.
 *
 * `unknown` is a real case, not a defensive branch. KNOWN_CHANNELS is
 * hand-maintained on both sides of the wire, so a channel added to
 * metadata-fields.mjs and published to the CDN before the client's copy is
 * rebuilt arrives here as a string this map has never seen. It falls back to
 * `unknown`, which renders the name in the ordinary ink: visibly unstyled
 * rather than confidently wrong.
 *
 * Do not give it a fourth hue. A channel with no identity colour must not look
 * like a channel that does, or the colour stops meaning anything.
 */
export function channelTone(channel: string | null | undefined): string {
  const name = String(channel ?? '')
    .trim()
    .toLowerCase();
  return CHANNEL_KEYS.has(name) ? name : 'unknown';
}

/** The classes for a channel, for a plain chip that is not a Badge. */
export function channelToneClasses(channel: string | null | undefined): string {
  return TONE[channelTone(channel)]!;
}
