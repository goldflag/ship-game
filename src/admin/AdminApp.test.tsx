import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { applyAdminAction, emptyProfile } from '../progression/rules';
import { AdminChecking, NotAdmin } from './AdminApp';
import { AdminConsole } from './AdminConsole';
import type { AdminPlayer } from './adminModel';
import { PlayerList, type PlayerListProps } from './PlayerList';
import { PlayerPanel, type PlayerPanelProps } from './PlayerPanel';

const account = { id: 'admin-1', name: 'Bill', email: 'bill@example.test' };
const players: AdminPlayer[] = [
  { id: 'admin-1', name: 'Bill', email: 'bill@example.test', role: 'admin', createdAt: new Date('2026-08-01T12:00:00Z') },
  { id: 'user-2', name: 'Ada', email: 'ada@example.test', role: 'user', createdAt: new Date('2026-09-20T12:00:00Z') },
  { id: 'user-3', name: '', email: 'quiet@example.test', role: 'user' },
];
const noop = () => {};
const listProps = (over: Partial<PlayerListProps> = {}): PlayerListProps => ({
  search: '', applied: '', field: 'email', list: { status: 'ready', players, total: 61 }, page: 0, pageSize: 25, selfId: account.id,
  onSearch: noop, onField: noop, onPage: noop, onSelect: noop, onRetry: noop, ...over,
});
const panelProps = (over: Partial<PlayerPanelProps> = {}): PlayerPanelProps => {
  let profile = emptyProfile();
  profile = applyAdminAction(profile, { action: 'grant-xp', amount: 4200, pool: 'usa' });
  profile = applyAdminAction(profile, { action: 'grant-xp', amount: 310, pool: 'free' });
  profile = applyAdminAction(profile, { action: 'unlock', nodeId: 'fletcher' });
  profile = { ...profile, earned: 9876 };
  return {
    player: players[1], self: false, role: { busy: false, onRole: noop },
    research: { research: { status: 'ready', profile }, busy: false, notice: { tone: 'done', text: 'Gave FLETCHER to Ada.' }, onAction: async () => true, onRetry: noop },
    ...over,
  };
};

describe('admin page', () => {
  test('an admin sees the header, search and an empty selection while players load', () => {
    const html = renderToStaticMarkup(<AdminConsole account={account} onSignOut={noop}/>);
    expect(html).toContain('Fleet Command');
    expect(html).toContain('Admin');
    expect(html).toContain('bill@example.test');
    expect(html).toContain('Sign out');
    expect(html).toContain('Back to the game');
    expect(html).toContain('href="/"');
    expect(html).toContain('Loading players…');
    expect(html).toContain('aria-label="Search players by email"');
    expect(html).toContain('No player selected');
  });

  test('the player list pages through accounts, newest first, with roles and join dates', () => {
    const html = renderToStaticMarkup(<PlayerList {...listProps({ selectedId: 'user-2' })}/>);
    expect(html).toContain('61 accounts');
    expect(html).toContain('1–25 of 61');
    expect(html).toContain('ada@example.test');
    expect(html).toContain('No display name');
    expect(html).toContain('>you<');
    expect(html.match(/data-role="admin"/g)?.length).toBe(1);
    expect(html).toContain('20 Sep 2026');
    expect(html).toMatch(/aria-pressed="true"[^>]*>.*Ada/);
    expect(html).toMatch(/aria-label="Previous page" disabled=""/);
    expect(html).not.toMatch(/aria-label="Next page" disabled=""/);
  });

  test('empty searches and failures say so', () => {
    expect(renderToStaticMarkup(<PlayerList {...listProps({ search: 'zed', applied: 'zed', list: { status: 'ready', players: [], total: 0 } })}/>))
      .toContain('No player’s email contains “zed”.');
    const failed = renderToStaticMarkup(<PlayerList {...listProps({ list: { status: 'error', error: 'This account is not an administrator.', players: [], total: 0 } })}/>);
    expect(failed).toContain('role="alert"');
    expect(failed).toContain('This account is not an administrator.');
    expect(failed).toContain('Retry');
  });

  test('a selected player shows identity, role and research with every control', () => {
    const html = renderToStaticMarkup(<PlayerPanel {...panelProps()}/>);
    expect(html).toContain('Ada');
    expect(html).toContain('user-2');
    expect(html).toContain('Copy account id');
    expect(html).toContain('Make admin');
    // XP per nation, free and lifetime.
    for (const text of ['United States', 'Japan', 'Germany', 'United Kingdom', '4,200', '310', '9,876', 'Free XP', 'Earned, lifetime']) expect(html).toContain(text);
    expect(html).toContain('Gave FLETCHER to Ada.');
    expect(html).toContain('Grant XP');
    expect(html).toContain('role="switch" aria-checked="false"');
    // Modelled ships only, with their standing and a toggle; starters are fixed.
    expect(html).toContain('FLETCHER');
    expect(html).not.toContain('CLEMSON');
    expect(html).toContain('aria-label="Remove FLETCHER"');
    expect(html).toContain('aria-label="Gift YAMATO"');
    expect(html).not.toContain('aria-label="Gift GLEAVES"');
    expect(html).toContain('Starter');
    expect(html).toContain('models/yamato-thumbnail.png');
    expect(html).toContain('Reset progress…');
  });

  test('an admin cannot remove their own role', () => {
    const html = renderToStaticMarkup(<PlayerPanel {...panelProps({ player: players[0], self: true })}/>);
    expect(html).toMatch(/disabled=""[^>]*>Remove admin</);
    expect(html).toContain('You cannot remove your own admin role.');
  });

  test('research loading, failure and a busy save', () => {
    const loading = renderToStaticMarkup(<PlayerPanel {...panelProps({ research: { ...panelProps().research, research: { status: 'loading' }, notice: undefined } })}/>);
    expect(loading).toContain('Loading research progress…');
    const failed = renderToStaticMarkup(<PlayerPanel {...panelProps({ research: { ...panelProps().research, research: { status: 'error', error: 'No player has that id.' } } })}/>);
    expect(failed).toContain('No player has that id.');
    const busy = renderToStaticMarkup(<PlayerPanel {...panelProps({ research: { ...panelProps().research, busy: true } })}/>);
    expect(busy).toContain('Saving…');
    // Waiting controls keep focus: aria-disabled, not disabled.
    expect(busy).toMatch(/aria-disabled="true"[^>]*aria-label="Gift YAMATO"/);
  });

  test('a signed-in player who is not an admin is told so, by account', () => {
    const html = renderToStaticMarkup(<NotAdmin account={{ id: 'user-2', name: 'Ada', email: 'ada@example.test' }} onSignOut={noop}/>);
    expect(html).toContain('Ada');
    expect(html).toContain('ada@example.test');
    expect(html).toContain('not an administrator');
    expect(html).toContain('Sign out');
    expect(html).toContain('Back to the game');
    expect(renderToStaticMarkup(<AdminChecking/>)).toContain('Checking your account');
  });
});
