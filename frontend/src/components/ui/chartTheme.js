// frontend/src/components/ui/chartTheme.js
// recharts reads nothing from the MUI theme. Left alone it keeps its own
// light-mode defaults — a #666 axis label and, worse, a hard-coded '#fff'
// tooltip plate (DefaultTooltipContent) whose label element is given no colour
// at all, so it inherits text.primary. On ink that is #E6EDF5 on #fff: 1.19:1,
// and the month or the date heading every tooltip simply is not there.
//
// Four charts across three staff pages had the same three faults, so the props
// live here once rather than being re-derived per chart. It reads through
// useTheme(), so inside the member portal's ThemeProvider it picks up the
// portal's palette instead of the staff one with no extra wiring.
import React from 'react';
import { useTheme } from '@mui/material/styles';

export const useChartTheme = () => {
    const t = useTheme();
    const line = t.palette.divider;
    return {
        // <CartesianGrid {...c.grid} /> — add vertical/horizontal at the call site.
        grid: { strokeDasharray: '3 3', stroke: line },
        // <XAxis {...c.axis} /> — spread first so a local tick/stroke still wins.
        axis: { tick: { fontSize: 12, fill: t.palette.text.secondary }, stroke: line },
        // Series keep their own colours: recharts paints each row from
        // entry.color, and on a stacked chart that colour is the only thing
        // telling Healthy from Watch from At risk. So no itemStyle here.
        tooltip: {
            contentStyle: {
                backgroundColor: t.palette.background.paper,
                border: `1px solid ${line}`,
                borderRadius: 10,
                fontSize: 13,
                boxShadow: t.shadows[4],
            },
            labelStyle: { color: t.palette.text.primary, fontWeight: 600 },
        },
        // <Legend {...c.legend} />. recharts paints each legend label in its
        // own series colour, which is the one place that rule works against
        // you: #10b981 as a word on white is 2.54:1. The swatch beside it
        // already carries the series colour, so the text does not have to.
        legend: {
            formatter: (value) => React.createElement(
                'span', { style: { color: t.palette.text.primary } }, value),
        },
    };
};

export default useChartTheme;
