import { useCarStore } from "@/state/carStore";
import { css } from "@emotion/react";
import { DetailedHTMLProps, ButtonHTMLAttributes, useState } from "react";
import { Modal } from "../modal/Modal";
import { Column } from "../flex/Column";
import { Title } from "../text/Title";
import { Description } from "../text/Description";
import { Map, Settings2, ScanEye } from "lucide-react";

const TOP_PANEL_HEIGHT = "3rem";
const breakpoints = [768];
const mq = breakpoints.map((bp) => `@media (max-width: ${bp}px)`);

interface ButtonProps
  extends DetailedHTMLProps<
    ButtonHTMLAttributes<HTMLButtonElement>,
    HTMLButtonElement
  > {
  isShow?: boolean;
}

export function TopNav({
  step,
  inspectorOpen = true,
  onMapClick,
  onInspectorToggle,
  onSettingsClick,
}: {
  step: number;
  inspectorOpen?: boolean;
  onMapClick?: () => void;
  onInspectorToggle?: () => void;
  onSettingsClick?: () => void;
}) {
  const setThirdMode = useCarStore((state) => state.setThirdMode);
  const thirdMode = useCarStore((state) => state.thirdMode);
  const isMobile = /Mobi|Android/i.test(navigator.userAgent);

  const [openModal, setOpenModal] = useState(false);

  return (
    <>
      <div
        className="mapforge-topbar"
        css={css({
          display: "flex",
          transition: ".5s",
          transform: "translate(0px, 0px)",
          position: "fixed",
          top: 0,
          left: 0,
          width: "100%",
          height: step === 2 ? "3.5rem" : TOP_PANEL_HEIGHT,
          backgroundColor: "#0b1420",
          borderBottom: "1px solid #263447",
          zIndex: 1000,
          justifyContent: "space-between",
          alignItems: "center",
        })}
      >
        <div
          css={css({
            paddingLeft: "1.35rem",
            alignItems: "center",
            flexDirection: "row",
            display: "flex",
            gap: "0.65rem",
          })}
        >
          <span
            css={css({
              display: "flex",
              alignItems: "center",
              gap: "0.55rem",
              fontSize: "14px",
              fontWeight: "700",
              color: "#f8fafc",
            })}
          >
            <span style={{ color: "#60a5fa", fontSize: "18px" }}>◆</span>
            MAPFORGE
          </span>
          {step === 2 && (
            <span
              css={css({
                color: "#8190a3",
                fontSize: "12px",
                paddingLeft: "0.7rem",
                borderLeft: "1px solid #334155",
                [mq[0]]: { display: "none" },
              })}
            >
              Digital twin · Building explorer
            </span>
          )}
        </div>

        <div
          css={css({
            padding: "0rem 0.75rem",
            display: "flex",
            alignItems: "center",
            gap: "0.35rem",
            [mq[0]]: {
              padding: "0 0.25rem",
            },
          })}
        >
          {step === 2 && (
            <>
              <NavButton isShow onClick={onMapClick} title="Return to map selection">
                <Map size={14} /> Map
              </NavButton>
              <NavButton
                isShow
                active={inspectorOpen}
                onClick={onInspectorToggle}
                title="Toggle building inspector"
              >
                <ScanEye size={14} /> Inspect
              </NavButton>
              <NavButton isShow onClick={onSettingsClick} title="Scene settings and export">
                <Settings2 size={14} /> Settings
              </NavButton>
            </>
          )}
        </div>

        <div
          css={css({
            paddingRight: "1.25rem",
            display: "flex",
            flexDirection: "row",
            gap: "0.5rem",
          })}
        >
          <NavButton
            isShow={true}
            onClick={() => window.open("https://github.com/stonyp/mapforge", "_blank", "noopener,noreferrer")}
          >
            GitHub
          </NavButton>
          {step !== 2 && (
            <NavButton isShow={step >= 1} onClick={() => setOpenModal(true)}>
              Options
            </NavButton>
          )}

          {!isMobile && (
            <>
              {thirdMode ? (
                <NavButton
                  isShow={step == 2}
                  onClick={() => setThirdMode(false)}
                >
                  Disable Car
                </NavButton>
              ) : (
                <NavButton
                  isShow={step == 2}
                  onClick={() => setThirdMode(true)}
                >
                  Car Mode
                </NavButton>
              )}
            </>
          )}
        </div>
      </div>

      <Modal isOpen={openModal} onClose={() => setOpenModal(false)}>
        <Column gap="0.5rem">
          <Title>Options </Title>
        </Column>
      </Modal>

      {/* ── Footer ── */}
      <div
        css={css({
          position: "fixed",
          bottom: 0,
          left: 0,
          width: "100%",
          padding: "0.4rem 1.5rem",
          backgroundColor: "#0b1420",
          borderTop: "1px solid #263447",
          zIndex: 9999,
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          fontSize: "11px",
          color: "#738196",
          pointerEvents: "none",
        })}
      >
        Built by AIssacArt
      </div>
    </>
  );
}

export function NavButton(props: ButtonProps & { active?: boolean }) {
  const { active, isShow, children, ...buttonProps } = props;
  return (
    <button
      css={css({
        color: active ? "#dbeafe" : "#aab7c7",
        backgroundColor: active ? "#17365c" : "transparent",
        border: active ? "1px solid #315c8e" : "1px solid transparent",
        padding: "0.48rem 0.72rem",
        borderRadius: "7px",
        fontWeight: "600",
        fontSize: "12px",
        display: isShow ? "inline-flex" : "none",
        alignItems: "center",
        gap: "0.4rem",
        whiteSpace: "nowrap",
        cursor: "pointer",
        transition: "background-color 0.16s ease, color 0.16s ease",
        ":hover": { backgroundColor: "#1e293b", color: "#f8fafc" },
      })}
      {...buttonProps}
    >
      {children}
    </button>
  );
}
