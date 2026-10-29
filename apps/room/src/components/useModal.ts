import { useLayoutEffect, type RefObject } from "react";

// 대화상자를 열 때 showModal, 닫힐 때(언마운트) 연 버튼으로 포커스를 돌려줍니다.
export function useModal(ref: RefObject<HTMLDialogElement | null>) {
  useLayoutEffect(() => {
    // React 19에서는 언마운트 cleanup 때 ref가 이미 null이라 여기서 잡아 둡니다.
    const el = ref.current!;
    const opener = document.activeElement as HTMLElement | null;
    el.showModal();
    return () => {
      el.close();
      if (opener?.isConnected) opener.focus();
    };
  }, [ref]);
}
