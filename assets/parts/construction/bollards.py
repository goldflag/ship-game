"""Generic low-poly mooring bollards in the shared forward/port/up frame.

Original silhouettes, not service-specific reconstructions. The sole is Z=0;
all castings follow the instance paint. Reuse the library's 12-sided fittings.
"""
from utility_fittings import Fitting


def create_single_bollard(part, col, helpers, materials):
    m = Fitting(col, helpers, materials)
    m.box('bedplate', (0, 0, .03), (.64, .64, .06))
    m.lathe('post-and-head', [(.22, .06), (.18, .16), (.18, .48),
                              (.25, .51), (.25, .58), (.22, .62)])
    return m.root


def create_t_head_bollard(part, col, helpers, materials):
    m = Fitting(col, helpers, materials)
    m.box('bedplate', (0, 0, .0375), (.64, .90, .075))
    m.lathe('post', [(.23, .075), (.18, .17), (.15, .60)])
    m.lathe('cross-head', [(.12, -.52), (.14, -.46), (.11, -.35),
                          (.11, .35), (.14, .46), (.12, .52)],
            center=(0, 0, .60), axis='y')
    return m.root


def create_inclined_bollards(part, col, helpers, materials):
    m = Fitting(col, helpers, materials)
    m.box('bedplate', (0, 0, .045), (.78, 1.64, .09))
    for label, side in [('port', 1), ('starboard', -1)]:
        # Collars seat the angled post ends on the flat sole.
        m.cyl(label + '-foot', (0, side*.40, .11), .22, .10)
        m.rod(label + '-post', (0, side*.40, .12), (0, side*.56, .76),
              .17, vertices=12)
        m.rod(label + '-head', (0, side*.55, .72), (0, side*.575, .82),
              .225, vertices=12)
    return m.root
