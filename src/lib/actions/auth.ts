
"use server";

import type { AuthenticatedUser, Role, UserDetailsResponse, LoginResponse, BasicResponse, UserStatusResponse } from "@/lib/types";
import { firestore, admin } from '@/lib/firebaseAdmin'; // Assumes firebaseAdmin.ts is set up
import type { Timestamp } from 'firebase-admin/firestore';

// Initial default users. ensureDefaultUsersExist will try to add these if they don't exist.
const initialMockUsers: Omit<AuthenticatedUser, 'otp_created_at' | 'otp'>[] = [
  { id: "admin", name: "Administrator", role: "admin", password: "admin" },
  { id: "employee", name: "Default Employee", role: "employee" },
  { id: "adm001", name: "Bob Johnson (Admin)", role: "admin", password: "bob" },
  { id: "hello", name: "HELLO", role: "admin", password: "hello" },
  { id: "Ashish", name: "Ashish Talati", role: "admin", password: "Ashish@1234" },
];


async function getUsersCollectionRef() {
    if (!firestore) {
        console.error("[Auth - getUsersCollectionRef] Firestore is not initialized. Cannot get collection.");
        throw new Error("Database service not available. Firestore not initialized.");
    }
    const usersCollection = firestore.collection('users');
    await ensureDefaultUsersExist(); // Ensure defaults are checked/added on first access
    return usersCollection;
}

async function ensureDefaultUsersExist() {
    console.log("[Auth - ensureDefaultUsersExist] Checking/Ensuring default users in Firestore 'users' collection...");
    if (!firestore) {
        console.error("[Auth - ensureDefaultUsersExist] Firestore is not initialized. Skipping default user check.");
        return;
    }

    const usersCollection = firestore.collection('users');
    const batch = firestore.batch();
    let writesMade = 0;

    for (const initialUser of initialMockUsers) {
        const userRef = usersCollection.doc(initialUser.id.toLowerCase());
        try {
            const userDoc = await userRef.get();
            if (!userDoc.exists) {
                console.log(`[Auth - ensureDefaultUsersExist] Default user with ID '${initialUser.id.toLowerCase()}' not found. Adding...`);
                const userDataForFirestore: any = {
                    ...initialUser,
                    id: initialUser.id.toLowerCase() // Ensure ID is stored in lowercase
                };
                // Firestore doesn't store undefined fields, so these deletions are fine
                delete userDataForFirestore.otp;
                delete userDataForFirestore.otp_created_at;
                batch.set(userRef, userDataForFirestore);
                writesMade++;
            }
        } catch (error) {
            console.error(`[Auth - ensureDefaultUsersExist] Error checking/adding default user '${initialUser.id.toLowerCase()}':`, error);
        }
    }

    if (writesMade > 0) {
        try {
            await batch.commit();
            console.log(`[Auth - ensureDefaultUsersExist] Added ${writesMade} missing default users to Firestore.`);
        } catch (error) {
            console.error("[Auth - ensureDefaultUsersExist] Error committing batch for default users:", error);
        }
    } else {
        console.log("[Auth - ensureDefaultUsersExist] All default users seem to exist or no new default users to add.");
    }
}


export async function checkUserStatus(userId: string): Promise<UserStatusResponse> {
    if (!firestore) {
        console.warn("[Auth - checkUserStatus] Firestore not available. Assuming user exists for safety in dev if DB is down.");
        return { exists: true }; // Potentially problematic assumption for production
    }
    const normalizedUserId = userId.toLowerCase();
    console.log(`[Auth - checkUserStatus] Checking status for user: ${normalizedUserId}`);
    try {
        const usersCollection = await getUsersCollectionRef();
        const userDoc = await usersCollection.doc(normalizedUserId).get();
        console.log(`[Auth - checkUserStatus] User ${normalizedUserId} exists: ${userDoc.exists}`);
        return { exists: userDoc.exists };
    } catch (error) {
        console.error(`[Auth - checkUserStatus] Error checking user status for ${normalizedUserId}:`, error);
        return { exists: false }; // Safer to assume not exists on error
    }
}

export async function fetchUserDetails(userId: string): Promise<UserDetailsResponse> {
  console.log(`[Auth - fetchUserDetails] Initiated for User ID: "${userId}"`);
  if (!firestore) {
    console.error("[Auth - fetchUserDetails] Firestore service is not available. Cannot fetch user details.");
    return { success: false, error: "Database service not available." };
  }

  const normalizedUserId = userId.toLowerCase();
  console.log(`[Auth - fetchUserDetails] Normalized User ID for query: "${normalizedUserId}"`);

  try {
    const usersCollection = await getUsersCollectionRef();
    console.log(`[Auth - fetchUserDetails] Attempting to get document from Firestore: users/${normalizedUserId}`);
    const userDoc = await usersCollection.doc(normalizedUserId).get();

    if (userDoc.exists) {
      const userData = userDoc.data() as AuthenticatedUser; // Assuming structure
      console.log(`[Auth - fetchUserDetails] User found in Firestore. Data:`, JSON.stringify(userData));
      return { success: true, user: { id: userData.id, name: userData.name, role: userData.role } };
    } else {
      console.log(`[Auth - fetchUserDetails] User document not found in Firestore for ID: "${normalizedUserId}"`);
      return { success: false, error: "User not found." };
    }
  } catch (error) {
    console.error(`[Auth - fetchUserDetails] Error fetching user details for ID "${normalizedUserId}" from Firestore:`, error);
    const errorMessage = error instanceof Error ? error.message : "An unexpected error occurred fetching user details.";
    return { success: false, error: `Failed to fetch user details: ${errorMessage}` };
  }
}

export async function loginUser(userId: string, password?: string): Promise<LoginResponse> {
  console.log(`[Auth - loginUser] Attempting login for User ID: "${userId}", Password provided: ${password ? 'Yes' : 'No'}`);
  if (!firestore) {
    console.error("[Auth - loginUser] Firestore service is not available.");
    return { success: false, error: "Database service not available." };
  }
  const normalizedUserId = userId.toLowerCase();
  console.log(`[Auth - loginUser] Normalized User ID for query: "${normalizedUserId}"`);

  try {
    const usersCollection = await getUsersCollectionRef();
    const userDoc = await usersCollection.doc(normalizedUserId).get();

    if (!userDoc.exists) {
      console.log(`[Auth - loginUser] User not found in Firestore for ID: "${normalizedUserId}"`);
      return { success: false, error: "User not found" };
    }

    const userDataFromDb = userDoc.data();
    if (!userDataFromDb) {
        console.log(`[Auth - loginUser] User data is undefined in Firestore for ID: "${normalizedUserId}"`);
        return { success: false, error: "User data corrupted or missing." };
    }

    const userData = userDataFromDb as AuthenticatedUser;
    console.log(`[Auth - loginUser] User data fetched from Firestore for "${normalizedUserId}": Name: ${userData.name}, Role: ${userData.role}, Stored Password (if admin): ${userData.password ? '******' : 'N/A'}`);

    if (userData.role === "admin") {
      console.log(`[Auth - loginUser] Admin user. Comparing passwords.`);
      console.log(`[Auth - loginUser] Provided password: "${password}", Stored password in DB: "${userData.password}"`);
      if (userData.password === password) {
        console.log(`[Auth - loginUser] Admin password match for "${normalizedUserId}".`);
        const userToReturn: AuthenticatedUser = {
            id: userData.id,
            name: userData.name,
            role: userData.role,
            otp_created_at: userData.otp_created_at
              ? (userData.otp_created_at as Timestamp).toDate()
              : undefined,
        };
        return { success: true, user: userToReturn };
      }
      console.log(`[Auth - loginUser] Admin password mismatch for "${normalizedUserId}".`);
      return { success: false, error: "Invalid credentials." };
    }
    console.log(`[Auth - loginUser] User role is "${userData.role}", not "admin". This path is for admin password login.`);
    return { success: false, error: "Login method not applicable for this user type here." };
  } catch (error) {
    console.error(`[Auth - loginUser] Error during login for "${normalizedUserId}" from Firestore:`, error);
    return { success: false, error: "An unexpected error occurred during login." };
  }
}

export async function generateAndStoreOTP(userId: string): Promise<BasicResponse> {
  if (!firestore) { return { success: false, error: "Database service not available." }; }
  const normalizedUserId = userId.toLowerCase();
  console.log(`[Auth - generateAndStoreOTP] Attempting for User ID: "${normalizedUserId}"`);
  try {
    const usersCollection = await getUsersCollectionRef();
    const userRef = usersCollection.doc(normalizedUserId);
    const userDoc = await userRef.get();

    if (userDoc.exists && userDoc.data()?.role === "employee") {
      const newOtp = Math.floor(100000 + Math.random() * 900000).toString();
      const otpCreatedAtTimestamp = admin.firestore.Timestamp.now(); // Firestore Timestamp

      const updateData = {
        otp: newOtp,
        otp_created_at: otpCreatedAtTimestamp
      };
      await userRef.update(updateData);
      console.log(`[Auth - generateAndStoreOTP] User: ${normalizedUserId}, Role: employee. Generated OTP: "${newOtp}", Created At (ISO): ${otpCreatedAtTimestamp.toDate().toISOString()}. Update data sent to Firestore:`, JSON.stringify(updateData));
      return { success: true, otp: newOtp, message: "OTP generated successfully." };
    }
    const userData = userDoc.data();
    console.log(`[Auth - generateAndStoreOTP] User not found or not employee: ${normalizedUserId}. Exists: ${userDoc.exists}, Role: ${userData?.role}`);
    return { success: false, error: "Failed to generate OTP. User not found or not an employee." };
  } catch (error) {
    console.error(`[Auth - generateAndStoreOTP] Error for "${normalizedUserId}":`, error);
    return { success: false, error: "An unexpected error occurred generating OTP." };
  }
}

export async function verifyOtp(userId: string, otp: string): Promise<LoginResponse> {
  if (!firestore) { return { success: false, error: "Database service not available." }; }
  const normalizedUserId = userId.toLowerCase();
  console.log(`[Auth - verifyOtp] Attempting verification for User ID: "${normalizedUserId}", OTP entered: "${otp}"`);

  try {
    const usersCollection = await getUsersCollectionRef();
    const userDoc = await usersCollection.doc(normalizedUserId).get();

    if (!userDoc.exists) {
      console.log(`[Auth - verifyOtp] User not found: "${normalizedUserId}"`);
      return { success: false, error: "User not found." };
    }
    const userData = userDoc.data() as AuthenticatedUser;
    const storedOtp = userData.otp;
    const storedOtpCreatedAtFirestore = userData.otp_created_at as Timestamp | undefined;
    const storedOtpCreatedAtDate = storedOtpCreatedAtFirestore ? storedOtpCreatedAtFirestore.toDate() : null;

    console.log(`[Auth - verifyOtp] User found: ${userData.name}. Stored OTP from DB: "${storedOtp}", Stored OTP Created At (ISO from DB): ${storedOtpCreatedAtDate ? storedOtpCreatedAtDate.toISOString() : 'N/A'}`);

    if (userData.role !== 'employee' || !storedOtp || !storedOtpCreatedAtDate) {
      console.log(`[Auth - verifyOtp] No active OTP found for user "${normalizedUserId}" or user is not an employee. Stored OTP: ${storedOtp}, Created At: ${storedOtpCreatedAtDate ? storedOtpCreatedAtDate.toISOString() : 'N/A'}`);
      return { success: false, error: "No active OTP found for this user. Please generate one." };
    }

    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;
    const otpAge = now - storedOtpCreatedAtDate.getTime();

    console.log(`[Auth - verifyOtp] Current time (ms): ${now}, OTP creation time (ms): ${storedOtpCreatedAtDate.getTime()}, OTP age (ms): ${otpAge}, Expiry limit (ms): ${fiveMinutes}`);

    if (otpAge > fiveMinutes) {
      console.log(`[Auth - verifyOtp] OTP expired for user "${normalizedUserId}". Age: ${otpAge}ms.`);
      return { success: false, error: "OTP has expired. Please generate a new one." };
    }

    if (otp === storedOtp) {
      console.log(`[Auth - verifyOtp] OTP Success for user "${normalizedUserId}". Entered: "${otp}", Stored: "${storedOtp}"`);
      const userToReturn: AuthenticatedUser = {
            id: userData.id,
            name: userData.name,
            role: userData.role,
            otp_created_at: storedOtpCreatedAtDate,
        };
      return { success: true, user: userToReturn };
    }

    console.log(`[Auth - verifyOtp] Invalid OTP for user "${normalizedUserId}". Entered: "${otp}", Stored: "${storedOtp}"`);
    return { success: false, error: "Invalid OTP." };
  } catch (error) {
    console.error(`[Auth - verifyOtp] Error during OTP verification for "${normalizedUserId}":`, error);
    return { success: false, error: "An unexpected error occurred verifying OTP." };
  }
}

export async function addUser(userId: string, userName: string, passwordProvided: string, role: Role): Promise<BasicResponse> {
  if (!firestore) { return { success: false, error: "Database service not available." }; }
  const normalizedUserId = userId.toLowerCase();
  console.log(`[Auth - addUser] Attempting to add User ID: "${normalizedUserId}", Name: "${userName}", Role: "${role}"`);
  try {
    const usersCollection = await getUsersCollectionRef();
    const userRef = usersCollection.doc(normalizedUserId);
    const userDoc = await userRef.get();

    if (userDoc.exists) {
      console.log(`[Auth - addUser] User with ID "${normalizedUserId}" already exists.`);
      return { success: false, error: "User with this ID already exists." };
    }

    const newUser: Partial<AuthenticatedUser> & { id: string } = {
      id: normalizedUserId,
      name: userName,
      role: role,
    };
    if (role === 'admin') {
        newUser.password = passwordProvided;
    }
    await userRef.set(newUser);
    console.log(`[Auth - addUser] Successfully added user:`, JSON.stringify(newUser));
    return { success: true, message: `User ${userName} added successfully.` };
  } catch (error) {
    console.error(`[Auth - addUser] Error adding user "${normalizedUserId}":`, error);
    return { success: false, error: "An unexpected error occurred adding user." };
  }
}

export async function deleteUser(userIdToDelete: string): Promise<BasicResponse> {
  if (!firestore) { return { success: false, error: "Database service not available." }; }
  const normalizedUserId = userIdToDelete.toLowerCase();
  if (initialMockUsers.some(u => u.id.toLowerCase() === normalizedUserId)) {
     console.log(`[Auth - deleteUser] Attempted to delete protected default user: ${normalizedUserId}`);
     return { success: false, error: `The default user account '${normalizedUserId}' cannot be deleted.` };
  }
  console.log(`[Auth - deleteUser] Attempting to delete User ID: "${normalizedUserId}"`);
  try {
    const usersCollection = await getUsersCollectionRef();
    const userRef = usersCollection.doc(normalizedUserId);
    const userDoc = await userRef.get();

    if (userDoc.exists) {
      await userRef.delete();
      console.log(`[Auth - deleteUser] Successfully deleted user with ID: ${normalizedUserId}`);
      return { success: true, message: "User deleted successfully." };
    }
    console.log(`[Auth - deleteUser] User not found for deletion: ${normalizedUserId}`);
    return { success: false, error: "User not found." };
  } catch (error) {
    console.error(`[Auth - deleteUser] Error for "${normalizedUserId}":`, error);
    return { success: false, error: "An unexpected error occurred deleting user." };
  }
}

export async function updateAdminDetails(adminId: string, name: string, newPassword?: string): Promise<BasicResponse> {
  if (!firestore) { return { success: false, error: "Database service not available." }; }
  const normalizedAdminId = adminId.toLowerCase();
  console.log(`[Auth - updateAdminDetails] Attempting to update Admin ID: "${normalizedAdminId}", New Name: "${name}", New Password Provided: ${newPassword ? 'Yes' : 'No'}`);
  try {
    const usersCollection = await getUsersCollectionRef();
    const adminRef = usersCollection.doc(normalizedAdminId);
    const adminDoc = await adminRef.get();

    if (!adminDoc.exists || adminDoc.data()?.role !== "admin") {
      console.log(`[Auth - updateAdminDetails] Admin user not found or role is not admin for ID: "${normalizedAdminId}"`);
      return { success: false, error: "Admin user not found." };
    }

    const updates: any = { name };
    if (newPassword) {
      updates.password = newPassword;
      console.log(`[Auth - updateAdminDetails] Password will be updated for "${normalizedAdminId}".`);
    }
    await adminRef.update(updates);
    console.log(`[Auth - updateAdminDetails] Admin details updated successfully for "${normalizedAdminId}". Updates:`, JSON.stringify(updates));
    return { success: true, message: "Admin details updated successfully." };
  } catch (error) {
    console.error(`[Auth - updateAdminDetails] Error updating admin details for "${normalizedAdminId}":`, error);
    return { success: false, error: "An unexpected error occurred updating admin details." };
  }
}

export async function getAllUsers(): Promise<AuthenticatedUser[]> {
  if (!firestore) {
    console.warn("[Auth - getAllUsers] Firestore not available. Returning empty list.");
    return [];
  }
  console.log("[Auth - getAllUsers] Fetching all users from Firestore.");
  try {
    const usersCollection = await getUsersCollectionRef();
    const snapshot = await usersCollection.get();
    const users: AuthenticatedUser[] = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      const otpCreatedAtFirestore = data.otp_created_at as Timestamp | undefined;
      const otpCreatedAtDate = otpCreatedAtFirestore ? otpCreatedAtFirestore.toDate() : undefined;

      users.push({
        id: data.id,
        name: data.name,
        role: data.role as Role,
        password: data.password,
        otp: data.otp,
        otp_created_at: otpCreatedAtDate
      });
    });
    console.log(`[Auth - getAllUsers] Fetched ${users.length} users from Firestore. First user (if any):`, users.length > 0 ? JSON.stringify(users[0]) : 'N/A');
    return users;
  } catch (error) {
    console.error("[Auth - getAllUsers] Error fetching all users from Firestore:", error);
    return [];
  }
}

export async function revokeOTP(userId: string): Promise<BasicResponse> {
  if (!firestore) { return { success: false, error: "Database service not available." }; }
  const normalizedUserId = userId.toLowerCase();
  console.log(`[Auth - revokeOTP] Attempting to revoke OTP for User ID: "${normalizedUserId}"`);
  try {
    const usersCollection = await getUsersCollectionRef();
    const userRef = usersCollection.doc(normalizedUserId);
    const userDoc = await userRef.get();

    if (userDoc.exists && userDoc.data()?.role === "employee") {
      await userRef.update({
        otp: admin.firestore.FieldValue.delete(),
        otp_created_at: admin.firestore.FieldValue.delete()
      });
      console.log(`[Auth - revokeOTP] OTP for user ID ${normalizedUserId} has been successfully revoked.`);
      return { success: true, message: `OTP for user has been revoked.` };
    }
    const userData = userDoc.data();
    console.log(`[Auth - revokeOTP] User not found or not an employee: ${normalizedUserId}. Exists: ${userDoc.exists}, Role: ${userData?.role}`);
    return { success: false, error: "User not found or not an employee." };
  } catch (error) {
    console.error(`[Auth - revokeOTP] Error revoking OTP for "${normalizedUserId}":`, error);
    return { success: false, error: "An unexpected error occurred revoking OTP." };
  }
}
