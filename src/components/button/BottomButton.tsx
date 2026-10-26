import { css } from "@emotion/react";
import { ButtonHTMLAttributes, DetailedHTMLProps } from "react";

interface ButtonProps
  extends DetailedHTMLProps<
    ButtonHTMLAttributes<HTMLButtonElement>,
    HTMLButtonElement
  > {
  isShow?: boolean;
}

export function NextButton(props: ButtonProps) {
  const { isShow, ...buttonProps } = props;
  return (
    <button
      css={css({
        position: "absolute",
        zIndex: 9999,
        right: "2rem",
        bottom: "2rem",
        color: "#f8fafc",
        backgroundColor: "#1268d3",
        border: "1px solid #3984df",
        padding: "0.75rem 1.25rem",
        borderRadius: "8px",
        fontWeight: "300",
        fontSize: "14px",
        boxShadow: "0 8px 24px rgba(2, 8, 23, 0.26)",
        cursor: "pointer",
        transition: "0.2s",
        display: isShow ? "flex" : "none",
        alignItems: "center",
        gap: "0.5rem",
        ":hover": {
          backgroundColor: "#0f2745",
        },
        ":disabled": {
          backgroundColor: "#334155",
          cursor: "not-allowed",
        },
      })}
      {...buttonProps}
    >
      {props.children}
    </button>
  );
}

export function PrevButton(props: ButtonProps) {
  const { isShow, ...buttonProps } = props;
  return (
    <button
      css={css({
        position: "absolute",
        zIndex: 9999,
        left: "2rem",
        bottom: "2rem",
        color: "#e2e8f0",
        backgroundColor: "#172437",
        border: "1px solid #334155",
        padding: "0.75rem 1.25rem",
        borderRadius: "8px",
        fontWeight: "300",
        fontSize: "14px",
        cursor: "pointer",
        transition: "0.2s",
        display: isShow ? "flex" : "none",
        alignItems: "center",
        gap: "0.5rem",
        ":hover": {
          backgroundColor: "#243449",
        },
        ":disabled": {
          backgroundColor: "#334155",
          cursor: "not-allowed",
        },
      })}
      {...buttonProps}
    >
      {props.children}
    </button>
  );
}

export function Button(props: ButtonProps) {
  const { isShow, ...buttonProps } = props;
  return (
    <button
      css={css({
        zIndex: 9999,
        color: "#f8fafc",
        backgroundColor: "#1268d3",
        border: "1px solid #3984df",
        padding: "0.75rem 1.25rem",
        borderRadius: "8px",
        fontWeight: "300",
        fontSize: "14px",
        cursor: "pointer",
        transition: "0.2s",
        display: isShow ? "" : "none",
        gap: "0.5rem",
        ":hover": {
          backgroundColor: "#ebeef0c2",
        },
        ":disabled": {
          backgroundColor: "#ebeef0c2",
          cursor: "not-allowed",
        },
      })}
      {...buttonProps}
    >
      {props.children}
    </button>
  );
}
