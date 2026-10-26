import React, { useRef, useEffect, useCallback } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { useCarStore } from "@/state/carStore";

const Car = ({
  focusTarget,
  focusDistance,
  topDown,
}: {
  focusTarget: THREE.Vector3 | null;
  focusDistance: number;
  topDown: boolean;
}) => {
  const carRef = useRef(null);
  const { camera } = useThree();
  const controlsRef = useRef<React.ComponentRef<typeof OrbitControls>>(null);
  const cameraTransition = useRef<{
    fromPosition: THREE.Vector3;
    toPosition: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
    elapsed: number;
  } | null>(null);
  const wasTopDown = useRef(false);
  const thirdMode = useCarStore((state) => state.thirdMode);
  const setThirdMode = useCarStore((state) => state.setThirdMode);
  const keys = useRef({ w: false, s: false, a: false, d: false });
  const velocity = useRef(0);

  const handleKeyDown = useCallback((e) => {
    switch (e.key.toLowerCase()) {
      case "w":
        keys.current.w = true;
        break;
      case "s":
        keys.current.s = true;
        break;
      case "a":
        keys.current.a = true;
        break;
      case "d":
        keys.current.d = true;
        break;
      case "escape":
        setThirdMode(false);
        if (document.exitPointerLock) {
          document.exitPointerLock();
        }
        break;
      default:
        break;
    }
  }, []);

  const handleKeyUp = useCallback((e) => {
    switch (e.key.toLowerCase()) {
      case "w":
        keys.current.w = false;
        break;
      case "s":
        keys.current.s = false;
        break;
      case "a":
        keys.current.a = false;
        break;
      case "d":
        keys.current.d = false;
        break;
      default:
        break;
    }
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [handleKeyDown, handleKeyUp]);

  useEffect(() => {
    if (thirdMode) {
      const handleClick = () => {
        if (document.pointerLockElement !== document.body) {
          document.body.requestPointerLock();
        }
      };
      window.addEventListener("click", handleClick);
      return () => window.removeEventListener("click", handleClick);
    }
  }, [thirdMode]);

  useEffect(() => {
    if (thirdMode) {
      const onMouseMove = (event) => {
        if (document.pointerLockElement === document.body && carRef.current) {
          carRef.current.rotation.y -= event.movementX * 0.002;
        }
      };
      document.addEventListener("mousemove", onMouseMove);
      return () => document.removeEventListener("mousemove", onMouseMove);
    }
  }, [thirdMode]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (wasTopDown.current && !topDown && focusTarget && controls && !thirdMode) {
      camera.position.set(
        focusTarget.x + focusDistance * 0.72,
        focusTarget.y + focusDistance * 0.82,
        focusTarget.z + focusDistance * 1.1
      );
      controls.target.copy(focusTarget);
      controls.update();
      wasTopDown.current = false;
      return;
    }
    if (topDown && controls) {
      const target = focusTarget ?? controls.target;
      const distance = focusDistance * 0.6;
      camera.up.set(0, 0, -1);
      camera.position.set(target.x, target.y + distance, target.z);
      controls.target.copy(target);
      controls.update();
      cameraTransition.current = null;
      wasTopDown.current = true;
      return;
    }
    camera.up.set(0, 1, 0);
    if (!focusTarget || !controls || thirdMode) return;
    const fromTarget = controls.target.clone();
    const direction = camera.position.clone().sub(fromTarget).normalize();
    cameraTransition.current = {
      fromPosition: camera.position.clone(),
      toPosition: focusTarget.clone().addScaledVector(direction, focusDistance),
      fromTarget,
      toTarget: focusTarget.clone(),
      elapsed: 0,
    };
  }, [camera, focusTarget, focusDistance, thirdMode, topDown]);

  useFrame((state, delta) => {
    const transition = cameraTransition.current;
    const controls = controlsRef.current;
    if (transition && controls && !thirdMode) {
      transition.elapsed = Math.min(1, transition.elapsed + delta / 0.9);
      const progress = transition.elapsed * transition.elapsed * (3 - 2 * transition.elapsed);
      camera.position.lerpVectors(transition.fromPosition, transition.toPosition, progress);
      controls.target.lerpVectors(transition.fromTarget, transition.toTarget, progress);
      controls.update();
      if (transition.elapsed === 1) cameraTransition.current = null;
    }

    if (carRef.current) {
      const accelerationRate = 0.2;
      const maxSpeed = 3.0;
      const decelerationRate = 1.0;
      if (keys.current.w) {
        velocity.current = Math.min(
          maxSpeed,
          velocity.current + accelerationRate * delta
        );
      } else if (keys.current.s) {
        velocity.current = Math.max(
          -maxSpeed,
          velocity.current - accelerationRate * delta
        );
      } else {
        if (velocity.current > 0) {
          velocity.current = Math.max(
            0,
            velocity.current - decelerationRate * delta
          );
        } else if (velocity.current < 0) {
          velocity.current = Math.min(
            0,
            velocity.current + decelerationRate * delta
          );
        }
      }
      if (keys.current.a) carRef.current.rotation.y += 0.02;
      if (keys.current.d) carRef.current.rotation.y -= 0.02;
      const forward = new THREE.Vector3(0, 0, -1);
      forward.applyQuaternion(carRef.current.quaternion);
      carRef.current.position.addScaledVector(forward, velocity.current);
    }
    if (thirdMode && carRef.current) {
      const carPos = carRef.current.position;
      const offset = new THREE.Vector3(0, 1, 2);
      offset.applyAxisAngle(
        new THREE.Vector3(0, 1, 0),
        carRef.current.rotation.y
      );
      const desiredPosition = carPos.clone().add(offset);
      camera.position.lerp(desiredPosition, 0.1);
      camera.lookAt(carPos);
    }
  });

  return (
    <>
      <mesh ref={carRef} position={[0, 0.5, 0]}>
        <boxGeometry args={[0.2, 0.2, 0.4]} />
        <meshStandardMaterial color="orange" />
      </mesh>
      {!thirdMode && (
        <OrbitControls
          ref={controlsRef}
          makeDefault
          enableDamping
          dampingFactor={0.08}
          minDistance={8}
          maxDistance={12000}
        />
      )}
    </>
  );
};

export default Car;
