import { useState } from 'react';
import { CategoryBreakdownItem, MonthlySeriesPoint } from '../utils/financeCalculations';
import { formatBRL } from '../utils/formatters';

interface GroupedBarChartProps {
  data: MonthlySeriesPoint[];
}

export function GroupedBarChart({ data }: GroupedBarChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (data.length === 0 || data.every((d) => d.incomes === 0 && d.expenses === 0)) {
    return (
      <div className="h-56 flex items-center justify-center text-sm text-slate-500 text-center px-4">
        Registre receitas e despesas para visualizar o comparativo mensal.
      </div>
    );
  }

  const maxVal = Math.max(100, ...data.flatMap((d) => [d.incomes, d.expenses]));
  const width = 560;
  const height = 220;
  const padLeft = 64;
  const padRight = 16;
  const padTop = 18;
  const padBottom = 32;
  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;
  const groupW = chartW / data.length;
  const barW = Math.min(22, Math.max(8, groupW * 0.28));

  const ticks = [0, 0.5, 1];

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-56 overflow-visible">
        {ticks.map((t) => {
          const y = padTop + chartH - t * chartH;
          const val = maxVal * t;
          return (
            <g key={t}>
              <line
                x1={padLeft}
                x2={width - padRight}
                y1={y}
                y2={y}
                stroke="#E2E8F0"
                strokeDasharray="3 3"
              />
              <text
                x={padLeft - 8}
                y={y + 4}
                textAnchor="end"
                className="fill-slate-400 text-[10px] font-mono"
              >
                {val >= 1000 ? `R$${(val / 1000).toFixed(1)}k` : `R$${Math.round(val)}`}
              </text>
            </g>
          );
        })}

        {data.map((d, idx) => {
          const cx = padLeft + groupW * idx + groupW / 2;
          const incH = (d.incomes / maxVal) * chartH;
          const expH = (d.expenses / maxVal) * chartH;
          const isHovered = hoveredIdx === idx;

          return (
            <g
              key={d.month}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
              onClick={() => setHoveredIdx(idx === hoveredIdx ? null : idx)}
              className="cursor-pointer"
            >
              {isHovered && (
                <rect
                  x={padLeft + groupW * idx + 4}
                  y={padTop}
                  width={Math.max(0, groupW - 8)}
                  height={chartH}
                  rx={6}
                  fill="#F1F5F9"
                />
              )}
              <rect
                x={cx - barW - 2}
                y={padTop + chartH - incH}
                width={barW}
                height={Math.max(2, incH)}
                rx={4}
                fill="#16A34A"
                className="transition-opacity duration-150"
                opacity={hoveredIdx === null || isHovered ? 1 : 0.65}
              />
              <rect
                x={cx + 2}
                y={padTop + chartH - expH}
                width={barW}
                height={Math.max(2, expH)}
                rx={4}
                fill="#0D3B2E"
                className="transition-opacity duration-150"
                opacity={hoveredIdx === null || isHovered ? 1 : 0.65}
              />
              <text
                x={cx}
                y={height - 10}
                textAnchor="middle"
                className="fill-slate-600 text-[11px] font-medium"
              >
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-[#16A34A]" />
            Receitas
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-[#0D3B2E]" />
            Despesas
          </span>
        </div>
        {hoveredIdx !== null && data[hoveredIdx] && (
          <div className="font-mono-num text-slate-800 bg-slate-100 px-2.5 py-1 rounded-md">
            {data[hoveredIdx].label}: Receitas {formatBRL(data[hoveredIdx].incomes)} · Despesas{' '}
            {formatBRL(data[hoveredIdx].expenses)}
          </div>
        )}
      </div>
    </div>
  );
}

interface DonutCategoryChartProps {
  items: CategoryBreakdownItem[];
}

export function DonutCategoryChart({ items }: DonutCategoryChartProps) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  if (items.length === 0) {
    return (
      <div className="h-56 flex items-center justify-center text-sm text-slate-500 text-center px-4">
        Nenhuma despesa registrada no período selecionado.
      </div>
    );
  }

  const total = items.reduce((s, i) => s + i.amount, 0);
  const size = 180;
  const stroke = 26;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  let cumulative = 0;

  return (
    <div className="flex flex-col sm:flex-row items-center gap-6">
      <div className="relative shrink-0">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          {items.map((item, idx) => {
            const fraction = total > 0 ? item.amount / total : 0;
            const dash = fraction * circumference;
            const offset = -cumulative * circumference;
            cumulative += fraction;
            const isSelected = activeIdx === idx;
            return (
              <circle
                key={item.category}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={item.color}
                strokeWidth={isSelected ? stroke + 4 : stroke}
                strokeDasharray={`${dash} ${circumference}`}
                strokeDashoffset={offset}
                className="cursor-pointer transition-all duration-150"
                opacity={activeIdx === null || isSelected ? 1 : 0.45}
                onMouseEnter={() => setActiveIdx(idx)}
                onMouseLeave={() => setActiveIdx(null)}
                onClick={() => setActiveIdx(idx === activeIdx ? null : idx)}
              />
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none px-4">
          <span className="text-[11px] text-slate-500 truncate max-w-[100px]">
            {activeIdx !== null && items[activeIdx] ? items[activeIdx].category : 'Total gasto'}
          </span>
          <span className="text-sm font-bold text-slate-900 font-mono-num">
            {activeIdx !== null && items[activeIdx]
              ? formatBRL(items[activeIdx].amount)
              : formatBRL(total)}
          </span>
        </div>
      </div>

      <div className="flex-1 w-full space-y-2 max-h-52 overflow-y-auto pr-1">
        {items.map((item, idx) => (
          <button
            key={item.category}
            type="button"
            onMouseEnter={() => setActiveIdx(idx)}
            onMouseLeave={() => setActiveIdx(null)}
            onClick={() => setActiveIdx(idx === activeIdx ? null : idx)}
            className={`w-full flex items-center justify-between gap-2 text-left px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer ${
              activeIdx === idx ? 'bg-slate-100' : 'hover:bg-slate-50'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="w-2.5 h-2.5 rounded-sm shrink-0"
                style={{ backgroundColor: item.color }}
              />
              <span className="text-xs font-medium text-slate-700 truncate">{item.category}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0 text-xs font-mono-num">
              <span className="text-slate-500">{item.percent.toFixed(0)}%</span>
              <span className="font-semibold text-slate-900">{formatBRL(item.amount)}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

interface AreaTrendChartProps {
  data: MonthlySeriesPoint[];
  valueKey: 'incomes' | 'expenses' | 'reserveCumulative' | 'debtPaidCumulative';
  color: string;
  fillColor: string;
  emptyMessage: string;
  seriesLabel: string;
}

export function AreaTrendChart({
  data,
  valueKey,
  color,
  fillColor,
  emptyMessage,
  seriesLabel,
}: AreaTrendChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (data.length === 0 || data.every((d) => d[valueKey] === 0)) {
    return (
      <div className="h-48 flex items-center justify-center text-sm text-slate-500 text-center px-4">
        {emptyMessage}
      </div>
    );
  }

  const values = data.map((d) => d[valueKey]);
  const maxVal = Math.max(100, ...values);
  const width = 520;
  const height = 190;
  const padLeft = 60;
  const padRight = 16;
  const padTop = 16;
  const padBottom = 28;
  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  const coords = data.map((d, idx) => {
    const x =
      data.length === 1
        ? padLeft + chartW / 2
        : padLeft + (idx / (data.length - 1)) * chartW;
    const y = padTop + chartH - (d[valueKey] / maxVal) * chartH;
    return { x, y, val: d[valueKey], label: d.label };
  });

  const linePath = coords
    .map((c, idx) => `${idx === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
    .join(' ');

  const areaPath =
    coords.length > 1
      ? `${linePath} L ${coords[coords.length - 1].x.toFixed(1)} ${(padTop + chartH).toFixed(1)} L ${coords[0].x.toFixed(1)} ${(padTop + chartH).toFixed(1)} Z`
      : '';

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-48 overflow-visible">
        {[0, 0.5, 1].map((t) => {
          const y = padTop + chartH - t * chartH;
          const v = maxVal * t;
          return (
            <g key={t}>
              <line
                x1={padLeft}
                x2={width - padRight}
                y1={y}
                y2={y}
                stroke="#E2E8F0"
                strokeDasharray="3 3"
              />
              <text
                x={padLeft - 8}
                y={y + 4}
                textAnchor="end"
                className="fill-slate-400 text-[10px] font-mono"
              >
                {v >= 1000 ? `R$${(v / 1000).toFixed(1)}k` : `R$${Math.round(v)}`}
              </text>
            </g>
          );
        })}

        {areaPath && <path d={areaPath} fill={fillColor} />}
        {coords.length > 1 && (
          <path d={linePath} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" />
        )}

        {coords.map((c, idx) => {
          const isHovered = hoveredIdx === idx;
          return (
            <g
              key={c.label + idx}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
              onClick={() => setHoveredIdx(idx === hoveredIdx ? null : idx)}
              className="cursor-pointer"
            >
              <circle cx={c.x} cy={c.y} r={14} fill="transparent" />
              <circle
                cx={c.x}
                cy={c.y}
                r={isHovered ? 5.5 : 3.5}
                fill="#FFFFFF"
                stroke={color}
                strokeWidth={2.5}
              />
              <text
                x={c.x}
                y={height - 8}
                textAnchor="middle"
                className="fill-slate-600 text-[11px] font-medium"
              >
                {c.label}
              </text>
            </g>
          );
        })}
      </svg>

      {hoveredIdx !== null && coords[hoveredIdx] && (
        <div className="mt-1 text-xs font-mono-num text-slate-800 bg-slate-100 inline-block px-2.5 py-1 rounded-md">
          {coords[hoveredIdx].label} · {seriesLabel}: {formatBRL(coords[hoveredIdx].val)}
        </div>
      )}
    </div>
  );
}

interface NetComparisonChartProps {
  data: MonthlySeriesPoint[];
}

export function NetComparisonChart({ data }: NetComparisonChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (data.length === 0 || data.every((d) => d.net === 0)) {
    return (
      <div className="h-48 flex items-center justify-center text-sm text-slate-500 text-center px-4">
        Adicione movimentações para comparar o resultado mensal da família.
      </div>
    );
  }

  const maxAbs = Math.max(100, ...data.map((d) => Math.abs(d.net)));
  const width = 520;
  const height = 190;
  const padLeft = 60;
  const padRight = 16;
  const padTop = 16;
  const padBottom = 28;
  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;
  const zeroY = padTop + chartH / 2;
  const groupW = chartW / data.length;
  const barW = Math.min(28, Math.max(10, groupW * 0.45));

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-48 overflow-visible">
        <line
          x1={padLeft}
          x2={width - padRight}
          y1={zeroY}
          y2={zeroY}
          stroke="#94A3B8"
          strokeWidth={1}
        />
        <text
          x={padLeft - 8}
          y={zeroY + 4}
          textAnchor="end"
          className="fill-slate-400 text-[10px] font-mono"
        >
          R$0
        </text>
        <text
          x={padLeft - 8}
          y={padTop + 8}
          textAnchor="end"
          className="fill-slate-400 text-[10px] font-mono"
        >
          +{maxAbs >= 1000 ? `${(maxAbs / 1000).toFixed(1)}k` : Math.round(maxAbs)}
        </text>
        <text
          x={padLeft - 8}
          y={padTop + chartH}
          textAnchor="end"
          className="fill-slate-400 text-[10px] font-mono"
        >
          -{maxAbs >= 1000 ? `${(maxAbs / 1000).toFixed(1)}k` : Math.round(maxAbs)}
        </text>

        {data.map((d, idx) => {
          const cx = padLeft + groupW * idx + groupW / 2;
          const barH = (Math.abs(d.net) / maxAbs) * (chartH / 2);
          const isPositive = d.net >= 0;
          const y = isPositive ? zeroY - barH : zeroY;
          const isHovered = hoveredIdx === idx;

          return (
            <g
              key={d.month}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
              onClick={() => setHoveredIdx(idx === hoveredIdx ? null : idx)}
              className="cursor-pointer"
            >
              <rect
                x={cx - barW / 2}
                y={y}
                width={barW}
                height={Math.max(2, barH)}
                rx={4}
                fill={isPositive ? '#16A34A' : '#DC2626'}
                opacity={hoveredIdx === null || isHovered ? 1 : 0.6}
              />
              <text
                x={cx}
                y={height - 8}
                textAnchor="middle"
                className="fill-slate-600 text-[11px] font-medium"
              >
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>

      {hoveredIdx !== null && data[hoveredIdx] && (
        <div className="mt-1 text-xs font-mono-num text-slate-800 bg-slate-100 inline-block px-2.5 py-1 rounded-md">
          {data[hoveredIdx].label} · Saldo do mês: {formatBRL(data[hoveredIdx].net)}
        </div>
      )}
    </div>
  );
}
