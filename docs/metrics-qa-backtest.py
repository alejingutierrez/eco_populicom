"""
Backtest de fórmulas ECO contra 482 días de DDECPR.

Objetivo: elegir la fórmula que mejor performa contra la ground truth de crisis,
no la que pidió el cliente. Cada decisión tiene que estar defendida con números
para la presentación final al cliente.

Ground truth de "día de crisis": negative_count >= 30 OR (neg_share >= 0.40 AND total >= 20).
Misma definición que usa el PPTX de Alejandro (slide 7).
"""
import json
import math
from statistics import mean, median, stdev

ROWS = json.load(open("/tmp/eco-backtest/snapshots.json"))
# Normaliza tipos: total_reach viene como string, todos los numericos como float/None.
for r in ROWS:
    for k in ["total_reach"]:
        r[k] = int(r[k] or 0)
    for k in ["total_mentions","positive_count","neutral_count","negative_count",
              "high_pertinence_count","total_likes","total_comments","total_shares"]:
        r[k] = int(r[k] or 0)
    for k in ["total_impact","total_engagement_score","nss","brand_health_index",
              "reputation_momentum","engagement_rate","amplification_rate",
              "engagement_velocity","crisis_risk_score","volume_anomaly_zscore",
              "nss_7d","nss_30d"]:
        v = r.get(k)
        r[k] = float(v) if v is not None else None
    r["date"] = r["date"][:10]  # YYYY-MM-DD

ROWS.sort(key=lambda r: r["date"])
N = len(ROWS)
print(f"Loaded {N} daily snapshots {ROWS[0]['date']} → {ROWS[-1]['date']}")


# -----------------------------
# Ground truth — días de crisis
# -----------------------------
def is_crisis_day(r):
    total = r["total_mentions"]
    neg = r["negative_count"]
    if total == 0:
        return False
    neg_share = neg / total
    return neg >= 30 or (neg_share >= 0.40 and total >= 20)

GT = [is_crisis_day(r) for r in ROWS]
print(f"Ground truth: {sum(GT)} días de crisis ({sum(GT)/N*100:.1f}%)")


# -----------------------------
# Helpers para ventanas históricas
# -----------------------------
def history_at(i, window):
    """Devuelve los N días previos a i (excluyente). Más reciente primero."""
    start = max(0, i - window)
    return list(reversed(ROWS[start:i]))


def avg(xs, default=None):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else default


def stdev_of(xs, default=None):
    xs = [x for x in xs if x is not None]
    if len(xs) < 2:
        return default
    m = sum(xs) / len(xs)
    return math.sqrt(sum((x - m) ** 2 for x in xs) / len(xs))


# -----------------------------
# Variantes de BHI
# -----------------------------
def bhi_components(i):
    """Componentes [0,1] usados por todas las variantes. Reach según versión."""
    r = ROWS[i]
    total = r["total_mentions"]
    if total == 0:
        return None
    h7 = history_at(i, 7)
    h14 = history_at(i, 14)
    h30 = history_at(i, 30)

    # NSS normalizado: usa nss_30d si existe, si no nss del día
    nss30d = r["nss_30d"] if r["nss_30d"] is not None else r["nss"]
    nss_norm = (nss30d + 100) / 200  # ∈ [0,1]

    # Engagement normalizado: avg engagement_rate 30d / 5.0 saturado
    er_history = [h["engagement_rate"] for h in h30 if h["engagement_rate"] is not None]
    er_avg = sum(er_history) / len(er_history) if er_history else (r["engagement_rate"] or 0)
    eng_norm = min(er_avg / 5.0, 1.0) if er_avg is not None else 0

    # --- Reach BUGGY (V0): reach_growth premia ataque ---
    reach_7d = sum(h["total_reach"] for h in h7) if h7 else 0
    reach_prev_7d = sum(h["total_reach"] for h in ROWS[max(0, i-14):max(0, i-7)]) if i >= 14 else 0
    reach_growth = ((reach_7d - reach_prev_7d) / reach_prev_7d) if reach_prev_7d > 0 else 0
    reach_norm_v0 = max(min((reach_growth + 1) / 2, 1.0), 0.0)

    # --- Reach FIXED (PPTX V2): log10(reach_30d) con signo de NSS_30d ---
    reach_30d = sum(h["total_reach"] for h in h30) if h30 else r["total_reach"]
    def reach_with_sign(nss_for_sign):
        if nss_for_sign is None:
            sign = 0
        elif nss_for_sign > 0:
            sign = 1
        elif nss_for_sign < -20:
            sign = -1
        else:
            sign = 0
        v = (sign * (math.log10(reach_30d) if reach_30d > 0 else 0) / 7 + 1) / 2
        return max(0.0, min(1.0, v))

    reach_norm_fix_30 = reach_with_sign(nss30d)
    # Variantes con ventanas más cortas para que reaccione a la crisis del día
    nss7d = avg([h["nss"] for h in h7])
    reach_norm_fix_7 = reach_with_sign(nss7d if nss7d is not None else nss30d)
    reach_norm_fix_today = reach_with_sign(r["nss"])

    # Pertinence ratio
    pert = r["high_pertinence_count"] / total

    return {
        "nss_norm": nss_norm,
        "eng_norm": eng_norm,
        "reach_norm_v0": reach_norm_v0,
        "reach_norm_fix": reach_norm_fix_30,
        "reach_norm_fix_7": reach_norm_fix_7,
        "reach_norm_fix_today": reach_norm_fix_today,
        "pert": pert,
    }


def bhi_variant(i, weights, reach_kind):
    """weights = (w_nss, w_eng, w_reach, w_pert), suma = 1.0."""
    c = bhi_components(i)
    if c is None:
        return None
    rn = {
        "v0": c["reach_norm_v0"],
        "fix": c["reach_norm_fix"],
        "fix_7": c["reach_norm_fix_7"],
        "fix_today": c["reach_norm_fix_today"],
    }[reach_kind]
    return (
        c["nss_norm"] * weights[0]
        + c["eng_norm"] * weights[1]
        + rn * weights[2]
        + c["pert"] * weights[3]
    )


BHI_VARIANTS = {
    # Bug en producción (reach_growth premia el ataque). Baseline.
    "V0_buggy_40_25_20_15":         ((0.40, 0.25, 0.20, 0.15), "v0"),
    # Fix con sign(nss_30d): el más conservador, reacción lenta.
    "V1a_fix30_40_25_20_15":        ((0.40, 0.25, 0.20, 0.15), "fix"),
    # Fix con sign(nss_7d): reacciona en una semana de tendencia negativa.
    "V1b_fix7_40_25_20_15":         ((0.40, 0.25, 0.20, 0.15), "fix_7"),
    # Fix con sign(nss_hoy): reacciona el mismo día de la crisis.
    "V1c_fixToday_40_25_20_15":     ((0.40, 0.25, 0.20, 0.15), "fix_today"),
    # Pesos cliente (30/30/20/20) con cada flavor de fix.
    "V2a_client_fix30":             ((0.30, 0.30, 0.20, 0.20), "fix"),
    "V2b_client_fix7":              ((0.30, 0.30, 0.20, 0.20), "fix_7"),
    "V2c_client_fixToday":          ((0.30, 0.30, 0.20, 0.20), "fix_today"),
    # Pertinencia-heavy con fix nss_7d (gobierno).
    "V3_pert_fix7_35_20_15_30":     ((0.35, 0.20, 0.15, 0.30), "fix_7"),
    # Signal heavy (NSS+pert dominantes) con fix nss_7d.
    "V4_signal_fix7_45_15_15_25":   ((0.45, 0.15, 0.15, 0.25), "fix_7"),
    # NSS-heavy con fix today.
    "V5_nss_fixToday_50_20_20_10":  ((0.50, 0.20, 0.20, 0.10), "fix_today"),
}


# -----------------------------
# Crisis Risk variants
# -----------------------------
def crisis_v1_score(i):
    """Fórmula actual en metrics-calculator."""
    r = ROWS[i]
    total = r["total_mentions"]
    if total == 0:
        return 0.0
    neg = r["negative_count"]
    pert = r["high_pertinence_count"]
    reach = r["total_reach"]

    h30 = history_at(i, 30)
    avg_neg_30 = avg([h["negative_count"] for h in h30])
    if avg_neg_30 is not None and avg_neg_30 > 0:
        spike = neg / avg_neg_30
    elif neg > 0:
        spike = 2.0
    else:
        spike = 0.0
    pert_factor = pert / total
    reach_factor = math.log10(reach) / 6 if reach > 0 else 0
    return spike * pert_factor * reach_factor


def crisis_v2_score(i, w_sev=0.5, w_vel=0.3, w_rel=0.2):
    """V2 PPTX condicional + aditivo + saturado [0,1]."""
    r = ROWS[i]
    total = r["total_mentions"]
    if total == 0:
        return 0.0
    neg = r["negative_count"]
    neg_share = neg / total
    pert_share = r["high_pertinence_count"] / total

    # Activación condicional
    if not (neg_share > 0.30 and total >= 20) and neg < 30:
        return 0.0

    # Volume anomaly z (vs 30d)
    h30 = history_at(i, 30)
    vol_avg = avg([h["total_mentions"] for h in h30])
    vol_std = stdev_of([h["total_mentions"] for h in h30])
    if vol_avg is not None and vol_std and vol_std > 0:
        vol_z = (total - vol_avg) / vol_std
    else:
        vol_z = 0

    severity = min(neg_share / 0.7, 1.0)
    velocity = max(0.0, min(vol_z / 3, 1.0))
    relevance = min(pert_share / 0.5, 1.0)

    raw = severity * w_sev + velocity * w_vel + relevance * w_rel
    confidence = min(math.log10(total) / 2, 1.0) if total > 1 else 0
    return raw * confidence  # ∈ [0,1]


CRISIS_VARIANTS = {
    "V1_current": (crisis_v1_score, "raw"),
    "V2_pptx_50_30_20": (lambda i: crisis_v2_score(i, 0.5, 0.3, 0.2), "saturated"),
    "V2_60_25_15":      (lambda i: crisis_v2_score(i, 0.6, 0.25, 0.15), "saturated"),
    "V2_50_35_15":      (lambda i: crisis_v2_score(i, 0.5, 0.35, 0.15), "saturated"),
    "V2_40_40_20":      (lambda i: crisis_v2_score(i, 0.4, 0.4, 0.2), "saturated"),
    "V2_55_30_15":      (lambda i: crisis_v2_score(i, 0.55, 0.30, 0.15), "saturated"),
}


# -----------------------------
# Engagement Velocity variants
# -----------------------------
def engvel_current(i):
    r = ROWS[i]
    total = r["total_mentions"]
    if total == 0:
        return None
    eng_today = r["total_engagement_score"] / total
    h7 = history_at(i, 7)
    eng_history = [h["total_engagement_score"] / h["total_mentions"]
                   for h in h7 if h["total_mentions"] > 0]
    avg7 = sum(eng_history) / len(eng_history) if eng_history else None
    if avg7 is None or avg7 <= 0.01:
        return None
    return ((eng_today - avg7) / avg7) * 100


def engvel_zscore_30d(i):
    r = ROWS[i]
    total = r["total_mentions"]
    if total == 0:
        return None
    eng_today = r["total_engagement_score"] / total
    h30 = history_at(i, 30)
    series = [h["total_engagement_score"] / h["total_mentions"]
              for h in h30 if h["total_mentions"] > 0]
    if len(series) < 7:
        return None
    m = sum(series) / len(series)
    s = math.sqrt(sum((x - m) ** 2 for x in series) / len(series))
    if s == 0:
        return 0.0
    return (eng_today - m) / s


def engvel_robust_z_30d(i):
    """Robust z usando MAD en lugar de stdev — menos sensible a outliers."""
    r = ROWS[i]
    total = r["total_mentions"]
    if total == 0:
        return None
    eng_today = r["total_engagement_score"] / total
    h30 = history_at(i, 30)
    series = [h["total_engagement_score"] / h["total_mentions"]
              for h in h30 if h["total_mentions"] > 0]
    if len(series) < 7:
        return None
    med = median(series)
    mad = median([abs(x - med) for x in series])
    if mad == 0:
        return 0.0
    return (eng_today - med) / (1.4826 * mad)  # 1.4826 ≈ stdev de N(0,1) vs MAD


# -----------------------------
# Polarization Index
# -----------------------------
def polarization(i):
    r = ROWS[i]
    total = r["total_mentions"]
    if total == 0:
        return None
    return (r["positive_count"] + r["negative_count"]) / total * 100


# -----------------------------
# Métricas de evaluación contra ground truth de crisis
# -----------------------------
def confusion_matrix(scores, gt, threshold, lower_is_worse=False):
    """
    scores: lista de números (mismo length que gt). Para BHI lower_is_worse=True (BHI bajo = peligroso).
    threshold: si lower_is_worse, alerta cuando score <= threshold; si no, score >= threshold.
    """
    tp = fp = tn = fn = 0
    for s, g in zip(scores, gt):
        if s is None:
            # sin datos: cuenta como TN si gt=False, FN si gt=True
            if g:
                fn += 1
            else:
                tn += 1
            continue
        alarm = (s <= threshold) if lower_is_worse else (s >= threshold)
        if alarm and g:
            tp += 1
        elif alarm and not g:
            fp += 1
        elif not alarm and g:
            fn += 1
        else:
            tn += 1
    return tp, fp, tn, fn


def f1_metrics(tp, fp, tn, fn):
    prec = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    rec = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    f1 = 2 * prec * rec / (prec + rec) if (prec + rec) > 0 else 0.0
    return prec, rec, f1


def best_threshold(scores, gt, candidates, lower_is_worse=False):
    best = None
    for t in candidates:
        tp, fp, tn, fn = confusion_matrix(scores, gt, t, lower_is_worse)
        prec, rec, f1 = f1_metrics(tp, fp, tn, fn)
        row = (t, tp, fp, fn, prec, rec, f1)
        if best is None or f1 > best[6]:
            best = row
    return best


def correlation_with_extreme_negative(scores, rows):
    """Para BHI: días con NSS<-20 deberían tener BHI bajo. Si el bug existe,
    la correlación es negativa o nula. Si está fixed, debe ser positiva (NSS bajo→BHI bajo)."""
    pairs = [(s, r["nss"]) for s, r in zip(scores, rows)
             if s is not None and r["nss"] is not None]
    if not pairs:
        return None
    n = len(pairs)
    mx = sum(p[0] for p in pairs) / n
    my = sum(p[1] for p in pairs) / n
    num = sum((p[0] - mx) * (p[1] - my) for p in pairs)
    dx = math.sqrt(sum((p[0] - mx) ** 2 for p in pairs))
    dy = math.sqrt(sum((p[1] - my) ** 2 for p in pairs))
    if dx == 0 or dy == 0:
        return 0.0
    return num / (dx * dy)


# -----------------------------
# Run it
# -----------------------------
print("\n" + "=" * 80)
print("BHI — Detección de crisis usando BHI bajo como señal")
print("=" * 80)
print(f"{'Variant':40s} {'thr':>5s} {'TP':>4s} {'FP':>4s} {'FN':>4s} {'Prec':>6s} {'Rec':>6s} {'F1':>6s} {'rNSS':>6s}")
bhi_results = {}
for name, (weights, kind) in BHI_VARIANTS.items():
    scores = [bhi_variant(i, weights, kind) for i in range(N)]
    bhi_results[name] = scores
    # Buscar threshold óptimo (BHI bajo = crisis). Probamos thresholds 0.4 a 0.7.
    candidates = [round(0.40 + j * 0.02, 2) for j in range(16)]
    best = best_threshold(scores, GT, candidates, lower_is_worse=True)
    t, tp, fp, fn, p, r, f1 = best
    rho = correlation_with_extreme_negative(scores, ROWS) or 0
    print(f"{name:40s} {t:5.2f} {tp:4d} {fp:4d} {fn:4d} {p:6.2f} {r:6.2f} {f1:6.2f} {rho:+6.2f}")

# Guardar específicamente el día 14-abril 2026 para inspección
print("\n14-abril 2026 (crisis Proyecto 1183) — BHI por variante:")
for name, scores in bhi_results.items():
    for s, r in zip(scores, ROWS):
        if r["date"] == "2026-04-14":
            print(f"  {name}: BHI={s:.3f}  NSS={r['nss']:.1f}  total={r['total_mentions']}  neg={r['negative_count']}")
            break

print("\n13-enero 2026 (FALSO POSITIVO histórico — día súper positivo):")
for name, scores in bhi_results.items():
    for s, r in zip(scores, ROWS):
        if r["date"] == "2026-01-13":
            print(f"  {name}: BHI={s:.3f}  NSS={r['nss']:.1f}  total={r['total_mentions']}")
            break


print("\n" + "=" * 80)
print("CRISIS RISK — Detección de crisis directa")
print("=" * 80)
print(f"{'Variant':30s} {'thr':>6s} {'TP':>4s} {'FP':>4s} {'FN':>4s} {'Prec':>6s} {'Rec':>6s} {'F1':>6s}")

for name, (fn_score, kind) in CRISIS_VARIANTS.items():
    scores = [fn_score(i) for i in range(N)]
    if kind == "saturated":
        candidates = [round(0.10 + j * 0.05, 2) for j in range(15)]
    else:
        candidates = [0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 5.0]
    best = best_threshold(scores, GT, candidates, lower_is_worse=False)
    t, tp, fp, fn_, p, r, f1 = best
    print(f"{name:30s} {t:6.2f} {tp:4d} {fp:4d} {fn_:4d} {p:6.2f} {r:6.2f} {f1:6.2f}")


print("\n" + "=" * 80)
print("ENGAGEMENT VELOCITY — distribución comparada")
print("=" * 80)
for name, fn_score in [("current_avg7d", engvel_current),
                       ("zscore_30d", engvel_zscore_30d),
                       ("robust_z_30d", engvel_robust_z_30d)]:
    series = [fn_score(i) for i in range(N)]
    valid = [s for s in series if s is not None and not math.isnan(s) and not math.isinf(s)]
    if not valid:
        print(f"  {name}: sin datos válidos")
        continue
    mn = min(valid); mx = max(valid)
    m = sum(valid) / len(valid)
    s2 = math.sqrt(sum((x - m) ** 2 for x in valid) / len(valid))
    p99 = sorted(valid)[int(0.99 * len(valid))]
    p1 = sorted(valid)[int(0.01 * len(valid))]
    print(f"  {name:18s}  n={len(valid):4d}  min={mn:9.2f}  p1={p1:8.2f}  mean={m:7.2f}  std={s2:7.2f}  p99={p99:8.2f}  max={mx:9.2f}")


print("\n" + "=" * 80)
print("POLARIZATION INDEX — validación 13-abril 2026 (PPTX claim: 65.5%)")
print("=" * 80)
for r in ROWS:
    if r["date"] in ("2026-04-13", "2026-04-14", "2026-04-15"):
        p = polarization(ROWS.index(r))
        nss = r["nss"]
        total = r["total_mentions"]
        print(f"  {r['date']}  pol={p:.1f}%  NSS={nss:.1f}  total={total}  pos+neg={r['positive_count']+r['negative_count']}")
