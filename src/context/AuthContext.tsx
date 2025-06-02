
"use client";

import type { AuthenticatedUser } from "@/lib/types";
import type { ReactNode } from "react";
import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { checkUserStatus } from "@/lib/actions/auth"; // Import the new action

interface AuthContextType {
  user: AuthenticatedUser | null;
  isLoading: boolean;
  login: (userData: AuthenticatedUser) => void;
  logout: () => void;
  updateLoggedInUser: (updatedUserData: Partial<AuthenticatedUser>) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const USER_STATUS_CHECK_INTERVAL = 60 * 1000; // 60 seconds

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  const performLogout = useCallback(() => {
    setUser(null);
    localStorage.removeItem("emsUser");
    router.push("/");
  }, [router]);

  useEffect(() => {
    try {
      const storedUser = localStorage.getItem("emsUser");
      if (storedUser) {
        const parsedUser = JSON.parse(storedUser);
        if (parsedUser.otp_created_at) {
          parsedUser.otp_created_at = new Date(parsedUser.otp_created_at);
        }
        setUser(parsedUser);
      }
    } catch (error) {
      console.error("Failed to parse user from localStorage", error);
      localStorage.removeItem("emsUser");
    }
    setIsLoading(false);
  }, []);

  const login = useCallback((userData: AuthenticatedUser) => {
    const userToStore = { ...userData };
    if (userToStore.otp_created_at && !(userToStore.otp_created_at instanceof Date)) {
        userToStore.otp_created_at = new Date(userToStore.otp_created_at);
    }
    setUser(userToStore);
    localStorage.setItem("emsUser", JSON.stringify(userToStore));
    if (userData.role === "admin") {
      router.push("/admin/dashboard");
    } else {
      router.push("/employee/dashboard");
    }
  }, [router]);

  const logout = useCallback(() => {
    performLogout();
  }, [performLogout]);

  const updateLoggedInUser = useCallback((updatedUserData: Partial<AuthenticatedUser>) => {
    setUser(prevUser => {
      if (!prevUser) return null;
      const newUser = { ...prevUser, ...updatedUserData };
      if (newUser.otp_created_at && !(newUser.otp_created_at instanceof Date)) {
        newUser.otp_created_at = new Date(newUser.otp_created_at);
      }
      localStorage.setItem("emsUser", JSON.stringify(newUser));
      return newUser;
    });
  }, []);

  // Effect for periodic user status check
  useEffect(() => {
    if (!user) {
      return; // No user logged in, nothing to check
    }

    const intervalId = setInterval(async () => {
      if (document.hidden) { // Don't check if tab is not visible
        return;
      }
      try {
        console.log(`AuthContext: Checking status for user ${user.id}`);
        const status = await checkUserStatus(user.id);
        if (!status.exists) {
          console.log(`AuthContext: User ${user.id} no longer exists. Logging out.`);
          performLogout(); // Use performLogout to avoid router dependency issues in interval
        } else {
          console.log(`AuthContext: User ${user.id} still exists.`);
        }
      } catch (error) {
        console.error("AuthContext: Error checking user status:", error);
        // Optionally, handle specific errors, e.g., network error might not mean immediate logout
      }
    }, USER_STATUS_CHECK_INTERVAL);

    return () => {
      clearInterval(intervalId); // Cleanup interval on component unmount or user change
    };
  }, [user, performLogout]); // Rerun if user changes, performLogout is stable due to useCallback

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout, updateLoggedInUser }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
