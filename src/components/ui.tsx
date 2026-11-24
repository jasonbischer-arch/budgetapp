import { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TextProps,
  View,
  ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { tint } from '@/lib/visuals';

export function Screen({
  children,
  refreshing,
  onRefresh,
  scroll = true,
}: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  scroll?: boolean;
}) {
  const c = useTheme();
  const inner = <View style={styles.content}>{children}</View>;
  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: c.background }]}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            onRefresh ? (
              <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} />
            ) : undefined
          }>
          {inner}
        </ScrollView>
      ) : (
        inner
      )}
    </SafeAreaView>
  );
}

type Variant = 'title' | 'heading' | 'body' | 'muted' | 'small' | 'money';

export function T({
  variant = 'body',
  color,
  style,
  ...props
}: TextProps & { variant?: Variant; color?: string }) {
  const c = useTheme();
  const base = {
    title: { fontSize: 28, fontWeight: '700' as const, color: c.text },
    heading: { fontSize: 17, fontWeight: '600' as const, color: c.text },
    body: { fontSize: 15, color: c.text },
    muted: { fontSize: 14, color: c.textSecondary },
    small: { fontSize: 12, color: c.textSecondary },
    money: { fontSize: 15, fontWeight: '600' as const, color: c.text, fontVariant: ['tabular-nums' as const] },
  }[variant];
  return <Text {...props} style={[base, color ? { color } : null, style]} />;
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const c = useTheme();
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: c.card,
          borderColor: c.border,
          boxShadow: `0 1px 2px ${c.shadow}, 0 6px 16px ${c.shadow}`,
        },
        style,
      ]}>
      {children}
    </View>
  );
}

/** Small uppercase label above a group of cards, with an optional action. */
export function SectionHeader({
  title,
  action,
  onAction,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  const c = useTheme();
  return (
    <Row style={{ justifyContent: 'space-between', marginTop: Spacing.sm, marginBottom: -Spacing.xs }}>
      <Text style={{ color: c.textSecondary, fontSize: 12, fontWeight: '700', letterSpacing: 0.8 }}>
        {title.toUpperCase()}
      </Text>
      {action && onAction && (
        <Pressable onPress={onAction} hitSlop={10}>
          <Text style={{ color: c.primary, fontSize: 14, fontWeight: '600' }}>{action}</Text>
        </Pressable>
      )}
    </Row>
  );
}

/** A row of mutually exclusive options (filters, sub-tabs). */
export function Segmented<V extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: V; label: string }[];
  value: V;
  onChange: (v: V) => void;
}) {
  const c = useTheme();
  return (
    <View style={[styles.segmented, { backgroundColor: c.track }]} accessibilityRole="tablist">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(o.value)}
            style={[
              styles.segment,
              selected && { backgroundColor: c.card, boxShadow: `0 1px 3px ${c.shadow}` },
            ]}>
            <Text
              numberOfLines={1}
              style={{
                fontSize: 13,
                fontWeight: selected ? '700' : '500',
                color: selected ? c.text : c.textSecondary,
              }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A headline number with a label (KPI tile). */
export function Stat({
  label,
  value,
  sub,
  color,
  accent,
  icon,
  style,
  onPress,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  /** Tints the tile with this color. */
  accent?: string;
  icon?: string;
  style?: ViewStyle;
  /** Makes the tile a button (shows a chevron). */
  onPress?: () => void;
}) {
  const tile = (
    <Card
      style={{
        flex: 1,
        gap: 2,
        padding: Spacing.md,
        ...(accent ? { backgroundColor: tint(accent, 0.1), borderColor: tint(accent, 0.25) } : null),
        ...style,
      }}>
      <T variant="small">
        {icon ? `${icon} ` : ''}
        {label}
        {onPress ? '  ›' : ''}
      </T>
      <T
        variant="money"
        color={color}
        style={{ fontSize: 20, fontWeight: '700' }}
        numberOfLines={1}
        adjustsFontSizeToFit>
        {value}
      </T>
      {sub ? <T variant="small">{sub}</T> : null}
    </Card>
  );
  if (!onPress) return tile;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}. Show details`}
      style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.7 : 1 })}>
      {tile}
    </Pressable>
  );
}

/** A highlight card with a diagonal gradient. */
export function GradientCard({
  colors,
  children,
  style,
}: {
  colors: readonly string[];
  children: ReactNode;
  style?: ViewStyle;
}) {
  return (
    <LinearGradient
      colors={colors as unknown as [string, string, ...string[]]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[{ borderRadius: Radius.lg + 4, padding: Spacing.xl, gap: Spacing.xs }, style]}>
      {children}
    </LinearGradient>
  );
}

/** An emoji in a softly tinted circle. */
export function IconBubble({ emoji, color, size = 36 }: { emoji: string; color: string; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: tint(color, 0.16),
        alignItems: 'center',
        justifyContent: 'center',
      }}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden>
      <Text style={{ fontSize: size * 0.5 }}>{emoji}</Text>
    </View>
  );
}

/** A small rounded label. */
export function Badge({ text, tone = 'neutral' }: { text: string; tone?: 'neutral' | 'primary' | 'warning' }) {
  const c = useTheme();
  const bg = tone === 'primary' ? c.primarySoft : tone === 'warning' ? c.warningSoft : c.track;
  const fg = tone === 'primary' ? c.primary : tone === 'warning' ? c.warning : c.textSecondary;
  return (
    <View style={{ backgroundColor: bg, borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 2 }}>
      <Text style={{ color: fg, fontSize: 11, fontWeight: '700' }}>{text}</Text>
    </View>
  );
}

/**
 * One row of a ranked bar list: name, figure, and a bar scaled to `max`.
 * An optional limit draws a tick and turns the figure red when exceeded.
 */
export function MeterRow({
  label,
  value,
  max,
  figure,
  detail,
  limit,
  color,
  icon,
  onPress,
}: {
  label: string;
  value: number;
  max: number;
  figure: string;
  detail?: string;
  limit?: number | null;
  /** Bar color (defaults to the app's single bar hue). */
  color?: string;
  /** Emoji shown before the label. */
  icon?: string;
  /** Makes the row a button (shows a chevron). */
  onPress?: () => void;
}) {
  const c = useTheme();
  const over = limit != null && limit > 0 && value > limit;
  const scale = Math.max(max, limit ?? 0) || 1;
  const a11y = `${label}: ${figure}${detail ? `, ${detail}` : ''}`;
  const row = (
    <View style={{ gap: 6 }} accessible={!onPress} accessibilityLabel={a11y}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Row style={{ gap: Spacing.sm, flexShrink: 1 }}>
          {icon && <IconBubble emoji={icon} color={color ?? c.bar} size={30} />}
          <T numberOfLines={1} style={{ flexShrink: 1 }}>
            {label}
          </T>
        </Row>
        <T variant="money" color={over ? c.negative : undefined}>
          {figure}
          {onPress ? <T variant="small"> ›</T> : null}
        </T>
      </Row>
      <View style={[styles.track, { backgroundColor: c.track }]}>
        <View
          style={{
            width: `${Math.min(1, value / scale) * 100}%`,
            height: '100%',
            backgroundColor: over ? c.negative : (color ?? c.bar),
            borderRadius: 4,
          }}
        />
        {limit != null && limit > 0 && (
          <View
            style={{
              position: 'absolute',
              left: `${Math.min(1, limit / scale) * 100}%`,
              top: -2,
              bottom: -2,
              width: 2,
              marginLeft: -1,
              backgroundColor: c.text,
              opacity: 0.55,
            }}
          />
        )}
      </View>
      {detail ? <T variant="small">{detail}</T> : null}
    </View>
  );
  if (!onPress) return row;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${a11y}. Show transactions`}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
      {row}
    </Pressable>
  );
}

export function Button({
  title,
  onPress,
  kind = 'primary',
  loading,
  disabled,
}: {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
  disabled?: boolean;
}) {
  const c = useTheme();
  const bg = kind === 'primary' ? c.primary : 'transparent';
  const fg = kind === 'primary' ? c.primaryText : kind === 'danger' ? c.negative : c.primary;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, borderColor: kind === 'primary' ? bg : c.border },
        (pressed || disabled) && { opacity: 0.6 },
      ]}>
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={{ color: fg, fontWeight: '600', fontSize: 15 }}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Input(props: TextInputProps) {
  const c = useTheme();
  return (
    <TextInput
      placeholderTextColor={c.textSecondary}
      {...props}
      style={[
        styles.input,
        { color: c.text, borderColor: c.border, backgroundColor: c.card },
        props.style,
      ]}
    />
  );
}

export function ProgressBar({ value, color }: { value: number; color: string }) {
  const c = useTheme();
  const pct = Math.max(0, Math.min(1, value));
  return (
    <View style={[styles.track, { backgroundColor: c.track }]}>
      <View style={{ width: `${pct * 100}%`, height: '100%', backgroundColor: color, borderRadius: 4 }} />
    </View>
  );
}

export function ErrorText({ message }: { message: string | null }) {
  const c = useTheme();
  if (!message) return null;
  return <T style={{ color: c.negative, marginVertical: Spacing.sm }}>{message}</T>;
}

export function Row({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

export function Divider() {
  const c = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border }} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { flexGrow: 1 },
  content: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    padding: Spacing.lg,
    gap: Spacing.lg,
  },
  segmented: { flexDirection: 'row', borderRadius: Radius.md, padding: 3, gap: 2 },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: Radius.sm + 2,
  },
  card: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  button: {
    minHeight: 46,
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    fontSize: 16,
  },
  track: { height: 8, borderRadius: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
});

/** A small selectable pill (filters, pickers). */
export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const c = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={{
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: Radius.pill,
        borderWidth: 1,
        borderColor: selected ? c.primary : c.border,
        backgroundColor: selected ? c.primary : 'transparent',
      }}>
      <T variant="small" color={selected ? c.primaryText : c.text}>
        {label}
      </T>
    </Pressable>
  );
}
