"""
Route prediction engine using Markov-chain transition probabilities
derived from historical vehicle trajectory data.
"""

from collections import defaultdict
from database.models import Trajectory, Camera, get_session


class RoutePredictionEngine:
    """Predicts next-camera destinations using historical trajectory patterns."""

    def __init__(self, session=None):
        self.session = session or get_session()
        self._transition_matrix = None

    def _build_transition_matrix(self):
        """
        Build a Markov-chain transition matrix from all trajectory camera sequences.
        transition_matrix[from_cam_id][to_cam_id] = probability
        """
        trajectories = self.session.query(Trajectory).all()

        # Count transitions
        transition_counts = defaultdict(lambda: defaultdict(int))
        for traj in trajectories:
            seq = traj.camera_sequence
            for i in range(len(seq) - 1):
                transition_counts[seq[i]][seq[i + 1]] += 1

        # Convert to probabilities
        transition_probs = {}
        for from_cam, targets in transition_counts.items():
            total = sum(targets.values())
            transition_probs[from_cam] = {
                to_cam: round(count / total, 3)
                for to_cam, count in targets.items()
            }

        self._transition_matrix = transition_probs
        return transition_probs

    def predict_next_cameras(self, current_camera_id: int, top_n: int = 5):
        """
        Predict the most likely next cameras from a given camera position.
        Returns a ranked list of (camera_id, camera_name, probability).
        """
        if self._transition_matrix is None:
            self._build_transition_matrix()

        probs = self._transition_matrix.get(current_camera_id, {})
        if not probs:
            return []

        cameras = {c.id: c for c in self.session.query(Camera).all()}

        predictions = []
        for cam_id, prob in sorted(probs.items(), key=lambda x: x[1], reverse=True)[:top_n]:
            cam = cameras.get(cam_id)
            if cam:
                predictions.append({
                    "camera_id": cam_id,
                    "camera_name": cam.name,
                    "location": cam.location_name,
                    "latitude": cam.latitude,
                    "longitude": cam.longitude,
                    "probability": prob,
                })

        return predictions

    def predict_route_for_plate(self, plate_text: str, steps: int = 3):
        """
        Given a vehicle plate, predict the most likely future route
        based on where the vehicle was last seen.
        """
        if self._transition_matrix is None:
            self._build_transition_matrix()

        # Get the most recent trajectory for this plate
        traj = (
            self.session.query(Trajectory)
            .filter(Trajectory.plate_text == plate_text.upper())
            .order_by(Trajectory.start_time.desc())
            .first()
        )

        if not traj or not traj.camera_sequence:
            return {"plate_text": plate_text, "predictions": [], "message": "No trajectory history found."}

        last_cam_id = traj.camera_sequence[-1]
        cameras = {c.id: c for c in self.session.query(Camera).all()}

        predicted_route = []
        current_cam = last_cam_id

        for step in range(steps):
            probs = self._transition_matrix.get(current_cam, {})
            if not probs:
                break

            # Pick highest probability next camera
            next_cam_id = max(probs, key=probs.get)
            cam = cameras.get(next_cam_id)
            if cam:
                predicted_route.append({
                    "step": step + 1,
                    "camera_id": next_cam_id,
                    "camera_name": cam.name,
                    "location": cam.location_name,
                    "latitude": cam.latitude,
                    "longitude": cam.longitude,
                    "probability": probs[next_cam_id],
                })
            current_cam = next_cam_id

        last_cam = cameras.get(last_cam_id)
        return {
            "plate_text": plate_text.upper(),
            "last_seen_camera": {
                "camera_id": last_cam_id,
                "camera_name": last_cam.name if last_cam else "Unknown",
                "location": last_cam.location_name if last_cam else "Unknown",
            },
            "predicted_route": predicted_route,
        }

    def get_transition_matrix_summary(self):
        """Returns the full transition matrix for visualization."""
        if self._transition_matrix is None:
            self._build_transition_matrix()

        cameras = {c.id: c for c in self.session.query(Camera).all()}
        summary = []

        for from_id, targets in self._transition_matrix.items():
            from_cam = cameras.get(from_id)
            for to_id, prob in targets.items():
                to_cam = cameras.get(to_id)
                if from_cam and to_cam:
                    summary.append({
                        "from_camera_id": from_id,
                        "from_name": from_cam.name,
                        "to_camera_id": to_id,
                        "to_name": to_cam.name,
                        "probability": prob,
                    })

        summary.sort(key=lambda x: x["probability"], reverse=True)
        return summary
