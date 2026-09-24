import { Button } from '../components';
import { awardSplit, type XpReadout } from './battleAward';
import './XpAward.css';

/** The battle's research XP on an end screen: tallying while the debrief settles, saving while the award is reported,
 * then "+N XP" and where it went. A failed report is a quiet line with Retry; the rest of the screen is unaffected. */
export function XpAward({ xp }: { xp: XpReadout }) {
  const { state } = xp;
  if (state.status === 'awarded') {
    const split = awardSplit(state.award);
    return <p className="xp-award" data-state="awarded" role="status">
      <span className="xp-label">Research</span>
      <strong className="xp-total">+{state.award.total.toLocaleString('en-US')} XP</strong>
      {split && <span className="xp-split">{split}</span>}
      {!state.award.total && xp.note && <span className="xp-split">{xp.note}</span>}
    </p>;
  }
  if (state.status === 'failed') return <p className="xp-award" data-state="failed" role="status">
    <span className="xp-label">Research</span>
    <span className="xp-error">XP not saved. {state.error}</span>
    <Button className="xp-retry" onClick={xp.retry}>Retry</Button>
  </p>;
  return <p className="xp-award" data-state="pending" role="status">
    <span className="xp-label">Research</span>
    <span className="xp-split">{state.status === 'saving' ? 'Saving XP…' : 'Tallying XP…'}</span>
  </p>;
}
