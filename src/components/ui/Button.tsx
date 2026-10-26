import type { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "small" | "medium";
}

export function Button({ variant = "secondary", size = "medium", className = "", type = "button", ...props }: ButtonProps) {
  return <button type={type} className={`button button-${variant} button-${size} ${className}`} {...props} />;
}
