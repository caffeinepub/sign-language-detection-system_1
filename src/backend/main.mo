import Principal "mo:core/Principal";
import Map "mo:core/Map";
import Array "mo:core/Array";
import Runtime "mo:core/Runtime";
import Order "mo:core/Order";
import Time "mo:core/Time";
import Int "mo:core/Int";

actor {
  type Detection = {
    timestamp : Time.Time;
    letter : Text;
  };

  module Detection {
    public func compare(d1 : Detection, d2 : Detection) : Order.Order {
      Int.compare(d1.timestamp, d2.timestamp);
    };
  };

  type Session = {
    detections : [Detection];
  };

  let sessions = Map.empty<Principal, Session>();

  public shared ({ caller }) func saveDetection(letter : Text) : async () {
    if (letter.size() != 1) {
      Runtime.trap("Invalid detection data");
    };

    let newDetection : Detection = {
      timestamp = Time.now();
      letter;
    };

    let session = switch (sessions.get(caller)) {
      case (null) {
        {
          detections = [newDetection];
        };
      };
      case (?existingSession) {
        {
          detections = existingSession.detections.concat([newDetection]);
        };
      };
    };

    sessions.add(caller, session);
  };

  public query ({ caller }) func getDetections() : async [Detection] {
    switch (sessions.get(caller)) {
      case (null) {
        [];
      };
      case (?session) {
        session.detections.sort();
      };
    };
  };

  public shared ({ caller }) func clearDetections() : async () {
    sessions.remove(caller);
  };
};
