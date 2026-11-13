/** Единая пружина для всех переходов — движение выглядит цельным. */
export const SPRING = { type: "spring", stiffness: 210, damping: 28, mass: 0.9 } as const;
export const EASE = [0.22, 1, 0.36, 1] as const;

export const FIELD_LIGHT = "#d9d9d9";
export const FIELD_DARK = "#1d1d1f";
