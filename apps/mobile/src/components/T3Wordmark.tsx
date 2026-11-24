import type { ColorValue } from "react-native";
import Svg, { Path } from "react-native-svg";
import { withUniwind } from "uniwind";

const ThemedPath = withUniwind(Path);

/** Three-triangle brand mark (replaces the old "T3" letterforms). */
export function T3Wordmark(props: {
  readonly height: number;
  readonly color?: ColorValue;
  readonly colorClassName?: string;
}) {
  return (
    <Svg accessibilityLabel="t3 code" height={props.height} width={props.height} viewBox="0 0 96 96">
      <ThemedPath
        d="M48 8 70.5 47.2H25.5Z"
        color={props.color}
        colorClassName={props.colorClassName}
        fill="currentColor"
      />
      <ThemedPath
        d="M24.2 50.2 46.7 89.4H1.7Z"
        color={props.color}
        colorClassName={props.colorClassName}
        fill="currentColor"
      />
      <ThemedPath
        d="M71.8 50.2 94.3 89.4H49.3Z"
        color={props.color}
        colorClassName={props.colorClassName}
        fill="currentColor"
      />
    </Svg>
  );
}
