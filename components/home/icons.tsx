import type { ReactNode } from "react";

/* Ícones de linha próprios (24x24), no traço fino do app. */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[22px] w-[22px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const homeIcons = {
  comment: (
    <Icon>
      <path d="M20.5 11.5a8.5 8.5 0 0 1-12.4 7.6L3.5 20.5l1.4-4.6A8.5 8.5 0 1 1 20.5 11.5z" />
    </Icon>
  ),
  direct: (
    <Icon>
      <path d="M21.5 3 10.2 10.6" />
      <path d="M21.5 3 15 21l-4.8-10.4L2.5 7.9z" />
    </Icon>
  ),
  contacts: (
    <Icon>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.5a6.5 6.5 0 0 1 3 5.5" />
    </Icon>
  ),
  shield: (
    <Icon>
      <path d="M12 2.8 4.5 5.6v5.6c0 4.6 3.1 8.5 7.5 10 4.4-1.5 7.5-5.4 7.5-10V5.6z" />
      <path d="m8.8 12 2.3 2.3 4.3-4.6" />
    </Icon>
  ),
  flow: (
    <Icon>
      <rect x="3" y="3" width="7" height="5.5" rx="1.5" />
      <rect x="14" y="15.5" width="7" height="5.5" rx="1.5" />
      <path d="M6.5 8.5v4a2.5 2.5 0 0 0 2.5 2.5h8.5v.5" />
    </Icon>
  ),
  clock: (
    <Icon>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.2 2" />
    </Icon>
  ),
  chart: (
    <Icon>
      <path d="M3.5 20.5h17" />
      <rect x="5" y="11" width="3" height="6.5" rx="0.8" />
      <rect x="10.5" y="6.5" width="3" height="11" rx="0.8" />
      <rect x="16" y="13.5" width="3" height="4" rx="0.8" />
    </Icon>
  ),
  unlink: (
    <Icon>
      <path d="M9.5 14.5 7.3 16.7a3.3 3.3 0 0 1-4.6-4.6l2.9-2.9a3.3 3.3 0 0 1 4.6 0" />
      <path d="m14.5 9.5 2.2-2.2a3.3 3.3 0 0 1 4.6 4.6l-2.9 2.9a3.3 3.3 0 0 1-4.6 0" />
    </Icon>
  ),
  check: (
    <Icon>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.2 2.7 2.7L16.2 9.4" />
    </Icon>
  ),
  video: (
    <Icon>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="m10.5 9.4 4.2 2.6-4.2 2.6z" />
    </Icon>
  ),
  upload: (
    <Icon>
      <path d="M12 16V4.5" />
      <path d="m7.5 9 4.5-4.5L16.5 9" />
      <path d="M4.5 15v3.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V15" />
    </Icon>
  ),
  sliders: (
    <Icon>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </Icon>
  ),
  lock: (
    <Icon>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </Icon>
  ),
};

