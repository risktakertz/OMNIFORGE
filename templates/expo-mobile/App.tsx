import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";

/**
 * Original starter screen (MIT): a restaurant ordering list with honest
 * network handling — the menu is fixture data; a real backend is a later,
 * approved milestone. Works on Android/iOS/web via Expo.
 */

type Item = { id: string; name: string; price: string; description: string };

const MENU: Item[] = [
  { id: "m1", name: "Grilled Chicken", price: "$8.50", description: "Charcoal grilled, with sides" },
  { id: "m2", name: "Vegetable Curry", price: "$7.00", description: "Coconut curry, mildly spiced" },
  { id: "m3", name: "Chapati Wrap", price: "$4.50", description: "Beef or veg, with kachumbari" },
  { id: "m4", name: "Fresh Juice", price: "$2.50", description: "Mango, passion or orange" },
];

export default function App() {
  const [cart, setCart] = useState<Record<string, number>>({});
  const [loading] = useState(false); // placeholder for a future approved API

  const add = (id: string) => setCart((c) => ({ ...c, [id]: (c[id] ?? 0) + 1 }));
  const count = Object.values(cart).reduce((a, b) => a + b, 0);

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <Text style={styles.title}>Sample Restaurant</Text>
      <Text style={styles.subtitle}>Menu — tap an item to add it to your order</Text>
      {loading ? (
        <ActivityIndicator />
      ) : (
        <FlatList
          data={MENU}
          keyExtractor={(i) => i.id}
          renderItem={({ item }) => (
            <Pressable style={styles.card} onPress={() => add(item.id)} accessibilityRole="button">
              <View style={{ flex: 1 }}>
                <Text style={styles.itemName}>{item.name}</Text>
                <Text style={styles.itemDesc}>{item.description}</Text>
              </View>
              <Text style={styles.price}>{item.price}</Text>
              {cart[item.id] ? <Text style={styles.badge}>×{cart[item.id]}</Text> : null}
            </Pressable>
          )}
        />
      )}
      <View style={styles.footer}>
        <Text style={styles.footerText}>{count} item(s) in your order (demo only — no real checkout)</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fafaf9", paddingTop: 54, paddingHorizontal: 16 },
  title: { fontSize: 24, fontWeight: "800", color: "#0f766e" },
  subtitle: { color: "#57534e", marginVertical: 8 },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 10, flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: "#e7e5e4" },
  itemName: { fontSize: 16, fontWeight: "700" },
  itemDesc: { color: "#57534e", fontSize: 13 },
  price: { fontWeight: "800", color: "#0f766e" },
  badge: { backgroundColor: "#0f766e", color: "#fff", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, overflow: "hidden", fontSize: 12 },
  footer: { paddingVertical: 12, borderTopWidth: 1, borderColor: "#e7e5e4" },
  footerText: { color: "#57534e", fontSize: 12 },
});
