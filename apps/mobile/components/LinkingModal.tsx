import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  FlatList,
} from "react-native";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Ionicons } from "@expo/vector-icons";

interface LinkingModalProps {
  visible: boolean;
  audiobookId: string;
  audiobookName: string;
  onClose: () => void;
}

export function LinkingModal({
  visible,
  audiobookId,
  audiobookName,
  onClose,
}: LinkingModalProps) {
  const [tab, setTab] = useState<"linked" | "available">("linked");

  const linkedBooks = useQuery(api.audiobooks.getLinked, {
    audiobookId: audiobookId as Id<"audiobooks">,
  });
  const nameMatches = useQuery(api.audiobooks.findByName, {
    name: audiobookName,
  });
  const linkMutation = useMutation(api.audiobooks.link);
  const unlinkMutation = useMutation(api.audiobooks.unlink);

  const availableToLink = (nameMatches || []).filter(
    (b) =>
      b._id !== audiobookId &&
      !(linkedBooks || []).some((lb) => lb._id === b._id)
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity
        className="flex-1 bg-black/40 justify-end"
        activeOpacity={1}
        onPress={onClose}
      >
        <View className="bg-white rounded-t-2xl max-h-[70%]">
          <View className="flex-row items-center justify-between px-4 py-3 border-b border-gray-200">
            <Text className="text-sm font-semibold text-gray-900">
              Link Audiobook
            </Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={20} color="#6b7280" />
            </TouchableOpacity>
          </View>

          <View className="flex-row border-b border-gray-200">
            <TouchableOpacity
              onPress={() => setTab("linked")}
              className="flex-1 py-2.5 items-center"
              style={tab === "linked" ? { borderBottomWidth: 2, borderBottomColor: "#f97316" } : {}}
            >
              <Text className={`text-xs font-medium ${tab === "linked" ? "text-primary" : "text-gray-500"}`}>
                Linked ({(linkedBooks || []).length})
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setTab("available")}
              className="flex-1 py-2.5 items-center"
              style={tab === "available" ? { borderBottomWidth: 2, borderBottomColor: "#f97316" } : {}}
            >
              <Text className={`text-xs font-medium ${tab === "available" ? "text-primary" : "text-gray-500"}`}>
                Available ({availableToLink.length})
              </Text>
            </TouchableOpacity>
          </View>

          {tab === "linked" ? (
            (linkedBooks || []).length === 0 ? (
              <View className="py-8 items-center">
                <Text className="text-xs text-gray-500">No linked audiobooks.</Text>
              </View>
            ) : (
              <FlatList
                data={linkedBooks || []}
                keyExtractor={(item) => item._id}
                renderItem={({ item }) => (
                  <View className="flex-row items-center justify-between px-4 py-3">
                    <View className="flex-1 mr-3">
                      <Text className="text-sm text-gray-900">{item.name}</Text>
                      <Text className="text-xs text-gray-500">
                        {item.chapters.length} chapters · {item.checksum.slice(0, 8)}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => unlinkMutation({
                        audiobookId: audiobookId as Id<"audiobooks">,
                        peerId: item._id,
                      })}
                    >
                      <Text className="text-xs text-red-500">Unlink</Text>
                    </TouchableOpacity>
                  </View>
                )}
              />
            )
          ) : availableToLink.length === 0 ? (
            <View className="py-8 items-center px-4">
              <Text className="text-xs text-gray-500 text-center">
                No other audiobooks with the name "{audiobookName}" found.
              </Text>
            </View>
          ) : (
            <FlatList
              data={availableToLink}
              keyExtractor={(item) => item._id}
              renderItem={({ item }) => (
                <View className="flex-row items-center justify-between px-4 py-3">
                  <View className="flex-1 mr-3">
                    <Text className="text-sm text-gray-900">{item.name}</Text>
                    <Text className="text-xs text-gray-500">
                      {item.chapters.length} chapters · {item.checksum.slice(0, 8)}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() =>
                      linkMutation({
                        canonicalId: audiobookId as Id<"audiobooks">,
                        linkedId: item._id,
                      })
                    }
                  >
                    <Text className="text-xs text-primary">Link</Text>
                  </TouchableOpacity>
                </View>
              )}
            />
          )}
        </View>
      </TouchableOpacity>
    </Modal>
  );
}
