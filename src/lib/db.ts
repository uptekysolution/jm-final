
import type { BoppRate, BoppRateHistory } from './types';
import { firestore, admin } from '@/lib/firebaseAdmin'; // Import Firestore instance
import type { Timestamp } from 'firebase-admin/firestore';

// Initial default rates (used if Firestore 'bopp_rates' collection is empty on first check)
const initialDefaultRates: BoppRate[] = [
    { id: 1, key: 'adhesive_less_rate', value: 80.0000 },
    { id: 2, key: 'adhesive_rate', value: 90.0000 },
    { id: 3, key: 'bopp_film_rate', value: 118.0000 },
    { id: 4, key: 'brown_tape', value: 105.0000 },
    { id: 5, key: 'coating_exp', value: 60.0000 },
    { id: 6, key: 'color_tape', value: 250.0000 },
    { id: 7, key: 'double_colour_printed', value: 225.0000 },
    { id: 8, key: 'four_colour_printed', value: 350.0000 },
    { id: 9, key: 'full_print', value: 1000.0000 },
    { id: 10, key: 'milky_white', value: 160.0000 },
    { id: 11, key: 'natural', value: 0.0000 },
    { id: 12, key: 'packing_cost', value: 220.0000 },
    { id: 13, key: 'profit', value: 10.0000 },
    { id: 14, key: 'single_colour_printed', value: 150.0000 },
    { id: 15, key: 'three_colour_printed', value: 300.0000 },
    { id: 16, key: 'transparent', value: 0.0000 },
    { id: 17, key: 'normal_paste_rate', value: 0 },
    { id: 18, key: 'waterproof_paste_rate', value: 15 },
    { id: 19, key: 'super_strong_paste_rate', value: 30 },
];

// Initial history (used if Firestore 'bopp_rate_history' collection is empty on first check)
const initialMockRateHistory: Omit<BoppRateHistory, 'changed_at' | 'id'>[] = [
    {
      changed_by_id: "system-init",
      changed_by_name: "System Initialization",
      rates_snapshot: [
        { id: 3, key: 'bopp_film_rate', value: 110.00 },
        { id: 2, key: 'adhesive_rate', value: 80.00 },
        { id: 12, key: 'packing_cost', value: 50.00 },
        { id: 13, key: 'profit', value: 7.00 },
      ]
    },
    {
      changed_by_id: "system-init",
      changed_by_name: "System Initialization",
      rates_snapshot: [
        { id: 3, key: 'bopp_film_rate', value: 115.00 },
        { id: 2, key: 'adhesive_rate', value: 85.00 },
        { id: 12, key: 'packing_cost', value: 55.00 },
        { id: 13, key: 'profit', value: 8.00 },
      ]
    }
];

async function seedInitialRates() {
    console.log("Attempting to seed initial BOPP rates in Firestore...");
    const ratesCollection = firestore.collection('bopp_rates');
    const batch = firestore.batch();
    let maxId = 0;
    initialDefaultRates.forEach(rate => {
        if (rate.id && rate.id > maxId) maxId = rate.id;
    });

    initialDefaultRates.forEach(rate => {
        const rateId = rate.id || ++maxId;
        const rateRef = ratesCollection.doc(rate.key); // Use rate.key as document ID
        batch.set(rateRef, { ...rate, id: rateId }); // Store id in the document as well
    });

    try {
        await batch.commit();
        console.log("Initial BOPP rates seeded successfully to Firestore 'bopp_rates' collection.");
    } catch (error) {
        console.error("Error seeding initial BOPP rates to Firestore:", error);
    }
}

async function seedInitialRateHistory() {
    console.log("Attempting to seed initial rate history in Firestore...");
    const historyCollection = firestore.collection('bopp_rate_history');
    const batch = firestore.batch();
    let idCounter = 1;

    initialMockRateHistory.forEach(entry => {
        const historyRef = historyCollection.doc(); // Auto-generate ID
        const historyEntryWithTimestamp: any = {
            ...entry,
            id: idCounter++, // Simple numeric ID for seeded history
            changed_at: admin.firestore.Timestamp.fromDate(new Date(Date.now() - (initialMockRateHistory.length - (idCounter-2)) * 24 * 60 * 60 * 1000)) // Stagger timestamps
        };
        batch.set(historyRef, historyEntryWithTimestamp);
    });

    try {
        await batch.commit();
        console.log("Initial rate history seeded successfully to Firestore 'bopp_rate_history' collection.");
    } catch (error) {
        console.error("Error seeding initial rate history to Firestore:", error);
    }
}

async function getBoppRatesCollectionRef() {
    const ratesCollection = firestore.collection('bopp_rates');
    const snapshot = await ratesCollection.limit(1).get();
    if (snapshot.empty) {
        const allDocsSnapshot = await ratesCollection.get();
        if (allDocsSnapshot.empty) {
           await seedInitialRates();
        }
    }
    return ratesCollection;
}

async function getBoppRateHistoryCollectionRef() {
    const historyCollection = firestore.collection('bopp_rate_history');
    const snapshot = await historyCollection.limit(1).get();
    if (snapshot.empty) {
         const allDocsSnapshot = await historyCollection.get();
        if (allDocsSnapshot.empty) {
            await seedInitialRateHistory();
        }
    }
    return historyCollection;
}


export async function getBoppRates(): Promise<BoppRate[]> {
  console.log("Fetching BOPP rates from Firestore...");
  try {
    const ratesCollection = await getBoppRatesCollectionRef();
    const snapshot = await ratesCollection.get();
    const rates: BoppRate[] = [];
    snapshot.forEach(doc => {
      rates.push(doc.data() as BoppRate);
    });
    // Ensure all default keys are present, add them if missing (useful for new keys in `initialDefaultRates`)
    const ratesMap = new Map(rates.map(r => [r.key, r]));
    let maxId = rates.reduce((max, r) => Math.max(max, r.id || 0), 0);

    initialDefaultRates.forEach(defaultRate => {
        if (!ratesMap.has(defaultRate.key)) {
            const newRate = { ...defaultRate, id: defaultRate.id || ++maxId };
            rates.push(newRate);
            // Optionally, write this new default rate to Firestore immediately
            // ratesCollection.doc(newRate.key).set(newRate).catch(err => console.error("Error adding missing default rate to Firestore:", err));
        }
    });


    return rates;
  } catch (error) {
    console.error("Error fetching BOPP rates from Firestore:", error);
    return []; // Return empty or initial defaults on error
  }
}

export async function updateBoppRates(newRatesFromForm: BoppRate[], userId: string, userName: string): Promise<void> {
  console.log(`Updating BOPP rates by ${userName} to Firestore...`);
  try {
    const ratesCollection = await getBoppRatesCollectionRef();
    const historyCollection = await getBoppRateHistoryCollectionRef();
    
    const currentRatesSnapshot = await ratesCollection.get();
    const currentRatesForHistory: BoppRate[] = [];
    currentRatesSnapshot.forEach(doc => currentRatesForHistory.push(doc.data() as BoppRate));

    // Create history entry
    const historyEntry: Omit<BoppRateHistory, 'id'> = { // Firestore will generate ID for new history document
      changed_at: admin.firestore.Timestamp.now(),
      changed_by_id: userId,
      changed_by_name: userName,
      rates_snapshot: currentRatesForHistory 
    };
    await historyCollection.add(historyEntry);

    // Update rates
    const batch = firestore.batch();
    let maxId = currentRatesForHistory.reduce((max, rate) => Math.max(max, rate.id || 0), 0);

    newRatesFromForm.forEach(formRate => {
      const rateRef = ratesCollection.doc(formRate.key);
      const rateData = { ...formRate };
      if (!rateData.id) {
          // Find if this key existed before to reuse ID or assign new
          const existing = currentRatesForHistory.find(r => r.key === formRate.key);
          rateData.id = existing?.id || ++maxId;
      } else if (rateData.id > maxId) {
          maxId = rateData.id;
      }
      batch.set(rateRef, rateData);
    });
    await batch.commit();
    console.log("BOPP rates and history updated in Firestore.");

  } catch (error) {
    console.error("Error updating BOPP rates in Firestore:", error);
    throw error; // Re-throw to be caught by the action
  }
}

export async function getRateHistory(limit: number = 5): Promise<BoppRateHistory[]> {
  console.log(`Fetching last ${limit} rate histories from Firestore...`);
  try {
    const historyCollection = await getBoppRateHistoryCollectionRef();
    const snapshot = await historyCollection.orderBy("changed_at", "desc").limit(limit).get();
    const history: BoppRateHistory[] = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      history.push({
        id: doc.id, // Use Firestore document ID
        changed_at: (data.changed_at as Timestamp).toDate(),
        changed_by_id: data.changed_by_id,
        changed_by_name: data.changed_by_name,
        rates_snapshot: data.rates_snapshot as BoppRate[]
      });
    });
    return history;
  } catch (error) {
    console.error("Error fetching rate history from Firestore:", error);
    return [];
  }
}
