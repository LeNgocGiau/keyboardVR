"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Camera, CameraOff, RotateCcw, Volume2 } from "lucide-react"

// Khai báo kiểu dữ liệu cho các đối tượng MediaPipe trong window
declare global {
  interface Window {
    Hands?: any;
    drawingUtils?: any;
    drawConnectors?: any;
    HAND_CONNECTIONS?: any;
    Camera?: any;
  }
}

const KEYBOARD_LAYOUT = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "="],
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P", "[", "]", "\\"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L", ";"],
  [ "Z", "X", "C", "V", "B", "N", "M", ",", ".", "/"],
  ["SPACE", "BACKSPACE"],
]

export default function HandGestureKeyboard() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const handsRef = useRef<any | null>(null)
  const cameraRef = useRef<any | null>(null)
  const drawingUtilsRef = useRef<any | null>(null)
  
  const [isStreaming, setIsStreaming] = useState(false)
  const [text, setText] = useState("")
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [gestureDetected, setGestureDetected] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [hasCameraDevices, setHasCameraDevices] = useState<boolean | null>(null)
  const [useDirectVideo, setUseDirectVideo] = useState(false)
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)
  const [handPosition, setHandPosition] = useState<{x: number, y: number} | null>(null)
  const [isHandOpen, setIsHandOpen] = useState(false)
  const [lastKeyPressTime, setLastKeyPressTime] = useState(0)
  const [showLandmarks, setShowLandmarks] = useState(true)
  const [librariesLoaded, setLibrariesLoaded] = useState(false)
  const [isLoadingLibraries, setIsLoadingLibraries] = useState(false)
  const [inputMode, setInputMode] = useState<"NORMAL" | "TELEX" | "VNI">("NORMAL")
  const [currentWord, setCurrentWord] = useState("")
  const [lastChar, setLastChar] = useState<{char: string, count: number} | null>(null)
  const [noRepeatedChars, setNoRepeatedChars] = useState(true) // Chế độ loại bỏ ký tự trùng lặp liên tiếp

  // Check for camera devices
  const checkCameraAvailability = async () => {
    try {
      console.log("MediaDevices object:", navigator.mediaDevices);
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(device => device.kind === 'videoinput');
      setHasCameraDevices(videoDevices.length > 0);
      console.log(`Found ${videoDevices.length} camera devices:`, videoDevices);
      return videoDevices.length > 0;
    } catch (error) {
      console.error("Error checking camera devices:", error);
      setHasCameraDevices(false);
      return false;
    }
  }

  // Check for permission explicitly
  const checkCameraPermissions = async () => {
    try {
      // This will trigger the permission prompt if not already granted
      const result = await navigator.permissions.query({ name: 'camera' as PermissionName });
      console.log("Camera permission status:", result.state);
      
      if (result.state === 'granted') {
        return true;
      } else if (result.state === 'prompt') {
        alert("Vui lòng cho phép quyền truy cập camera khi được hỏi.");
      } else if (result.state === 'denied') {
        alert("Quyền truy cập camera đã bị từ chối. Vui lòng thay đổi cài đặt trình duyệt của bạn.");
        return false;
      }
    } catch (error) {
      console.error("Error checking camera permissions:", error);
    }
    return false;
  }

  // Hard restart camera
  const restartCamera = async () => {
    console.log("Force restarting camera...");
    
    // First make sure it's stopped
    stopCamera();
    
    // Wait longer to ensure camera is released
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // First try to get permissions explicitly
    await checkCameraPermissions();
    
    // Then try to start the camera
    startCamera();
  }

  // Load MediaPipe Script
  const loadMediaPipeScript = (src: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => resolve();
      script.onerror = (error) => reject(error);
      document.head.appendChild(script);
    });
  };
  
  // Load Mediapipe libraries
  const loadHandsLibrary = async (): Promise<boolean> => {
    if (librariesLoaded) return true;
    if (isLoadingLibraries) return false;
    
    try {
      setIsLoadingLibraries(true);
      
      // Tải MediaPipe libraries từ CDN
      await loadMediaPipeScript('https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils/drawing_utils.js');
      await loadMediaPipeScript('https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js');
      await loadMediaPipeScript('https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js');
      
      console.log("MediaPipe scripts loaded");
      
      // Đợi một chút để các đối tượng được tạo trong window
      await new Promise(resolve => setTimeout(resolve, 500));
      
      if (!window.Hands) {
        console.error("MediaPipe Hands not found in window object");
        return false;
      }
      
      // Khởi tạo đối tượng Hands
      const hands = new window.Hands({
        locateFile: (file: string) => {
          return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
        }
      });

      hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
      });
      
      // Gán cho ref
      handsRef.current = hands;
      
      // Đánh dấu đã tải xong
      setLibrariesLoaded(true);
      setIsLoadingLibraries(false);
      
      console.log("MediaPipe Hands library loaded successfully");
      return true;
    } catch (error) {
      console.error("Error loading MediaPipe Hands library:", error);
      setIsLoadingLibraries(false);
      return false;
    }
  }

  // Khởi tạo camera
  const startCamera = async () => {
    try {
      // Check for camera availability first
      const hasCamera = await checkCameraAvailability();
      if (!hasCamera) {
        alert("Không tìm thấy thiết bị camera trên máy của bạn.");
        return;
      }
      
      // Load MediaPipe Hands library
      const handsLoaded = await loadHandsLibrary();
      if (!handsLoaded) {
        alert("Không thể tải thư viện nhận diện cử chỉ tay. Vui lòng thử lại.");
        return;
      }
      
      // First try to release any existing camera streams
      stopCamera();
      
      // Add a small delay to ensure camera is properly released
      await new Promise(resolve => setTimeout(resolve, 500));

      console.log("Starting camera with constraints...");
      
      // Try with specific constraints first
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: 640,
            height: 480,
            facingMode: "user",
          },
          audio: false
        });

        setupVideoStream(stream);
      } catch (error) {
        // If specific constraints fail, try with basic constraints
        console.log("Retrying with basic camera constraints");
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: true,
          });
          
          setupVideoStream(stream);
        } catch (innerError) {
          // Specifically handle errors from the basic constraints attempt
          console.error("Failed with basic constraints:", innerError);
          throw innerError; // Re-throw to be caught by outer catch
        }
      }
    } catch (error) {
      console.error("Lỗi truy cập camera:", error);
      
      // Show more specific error messages with more details
      if (error instanceof DOMException) {
        if (error.name === "NotReadableError") {
          alert(`Camera đang được sử dụng bởi ứng dụng khác. Chi tiết: ${error.message}`);
        } else if (error.name === "NotAllowedError") {
          alert("Vui lòng cho phép quyền truy cập camera.");
        } else if (error.name === "NotFoundError") {
          alert("Không tìm thấy thiết bị camera.");
        } else {
          alert(`Lỗi camera: ${error.name} - ${error.message}`);
        }
      } else {
        alert(`Không thể truy cập camera. Lỗi: ${error?.toString() || "Unknown error"}`);
      }
    }
  }

  // Helper to setup video stream
  const setupVideoStream = (stream: MediaStream) => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      setIsStreaming(true);
      console.log("Video stream attached to video element");

      // Bắt đầu vẽ video lên canvas
      videoRef.current.onloadedmetadata = () => {
        console.log("Video metadata loaded");
        videoRef.current?.play().catch(e => console.error("Error playing video:", e));
        
        // Initialize MediaPipe Hands
        if (handsRef.current && window.Camera) {
          // Set up hands processing
          handsRef.current.onResults(onHandResults);
          
          // Set up camera feed for Mediapipe
          cameraRef.current = new window.Camera(videoRef.current, {
            onFrame: async () => {
              if (handsRef.current && videoRef.current) {
                try {
                  await handsRef.current.send({image: videoRef.current});
                } catch (e) {
                  console.error("Error in Hands processing:", e);
                }
              }
            },
            width: 640,
            height: 480
          });
          
          console.log("Starting MediaPipe camera");
          cameraRef.current.start();
        } else {
          // Fallback to normal canvas drawing if MediaPipe fails
          console.warn("MediaPipe setup failed, falling back to basic canvas drawing");
          drawVideoFrame();
        }
      };
      
      videoRef.current.onerror = (e) => {
        console.error("Video element error:", e);
      };
    }
  }

  // Xử lý kết quả nhận diện tay từ MediaPipe
  const onHandResults = (results: any) => {
    if (!canvasRef.current || !results) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Xóa canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Vẽ hình ảnh từ camera lên canvas
    if (results.image) {
      ctx.save();
      ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
      ctx.restore();
    }
    
    // Vẽ bàn phím ảo lên canvas
    drawVirtualKeyboard(ctx);
    
    // Vẽ nhận diện tay
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      const landmarks = results.multiHandLandmarks[0];
      
      // Vẽ điểm mốc của bàn tay nếu được bật
      if (showLandmarks && window.drawingUtils) {
        for (const landmark of landmarks) {
          window.drawingUtils.drawLandmarks(ctx, [landmark], {
            color: 'red',
            fillColor: 'white',
            radius: 2
          });
        }
        
        // Vẽ đường nối giữa các điểm mốc
        if (window.drawConnectors && window.HAND_CONNECTIONS) {
          window.drawConnectors(ctx, landmarks, window.HAND_CONNECTIONS, {
            color: '#00FF00',
            lineWidth: 2
          });
        }
      }
      
      // Lấy vị trí ngón cái (điểm số 4 trong danh sách điểm mốc)
      const thumbTip = landmarks[4];
      const thumbX = thumbTip.x * canvas.width;
      const thumbY = thumbTip.y * canvas.height;
      
      // Cập nhật vị trí tay
      setHandPosition({x: thumbX, y: thumbY});
      
      // Kiểm tra xem tay đang mở hay đóng (hi-five vs nắm tay)
      const isHiFive = checkHiFiveGesture(landmarks);
      setIsHandOpen(isHiFive);
      
      // Kiểm tra xem ngón cái có đang trỏ vào phím nào không
      const key = getKeyAtPosition(thumbX, thumbY);
      if (key !== hoveredKey) {
        setHoveredKey(key);
      }
      
      // Nếu tay đang mở (hi-five) và đang trỏ vào một phím
      const now = Date.now();
      if (isHiFive && key && now - lastKeyPressTime > 1000) { // 1 giây chặn để tránh nhấn liên tục
        handleKeyPress(key);
        setLastKeyPressTime(now);
      }
      
      // Vẽ vòng tròn đánh dấu vị trí ngón cái
      ctx.beginPath();
      ctx.arc(thumbX, thumbY, 15, 0, 2 * Math.PI);
      ctx.fillStyle = "rgba(255, 255, 0, 0.5)";
      ctx.fill();
      
      // Vẽ text hiển thị cử chỉ tay
      ctx.font = "16px Arial";
      ctx.fillStyle = "white";
      ctx.fillText(
        isHiFive ? "Cử chỉ: Hi-Five (Chọn)" : "Cử chỉ: Chưa mở tay", 
        10, 
        30
      );
    } else {
      // Nếu không phát hiện tay
      setHandPosition(null);
      setHoveredKey(null);
      setIsHandOpen(false);
    }
  }
  
  // Kiểm tra cử chỉ Hi-Five (5 ngón tay đều mở)
  const checkHiFiveGesture = (landmarks: any[]): boolean => {
    if (!landmarks || landmarks.length < 21) return false;
    
    // Lấy các điểm mốc chính
    const wrist = landmarks[0];
    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];
    const middleTip = landmarks[12];
    const ringTip = landmarks[16];
    const pinkyTip = landmarks[20];
    
    // Lấy các điểm gốc ngón tay
    const thumbBase = landmarks[2];
    const indexBase = landmarks[5];
    const middleBase = landmarks[9];
    const ringBase = landmarks[13];
    const pinkyBase = landmarks[17];
    
    // Tính khoảng cách từ đầu ngón tay đến cổ tay
    const thumbToWristDist = distance3D(thumbTip, wrist);
    const indexToWristDist = distance3D(indexTip, wrist);
    const middleToWristDist = distance3D(middleTip, wrist);
    const ringToWristDist = distance3D(ringTip, wrist);
    const pinkyToWristDist = distance3D(pinkyTip, wrist);
    
    // Tính khoảng cách từ gốc ngón tay đến cổ tay
    const thumbBaseToWristDist = distance3D(thumbBase, wrist);
    const indexBaseToWristDist = distance3D(indexBase, wrist);
    const middleBaseToWristDist = distance3D(middleBase, wrist);
    const ringBaseToWristDist = distance3D(ringBase, wrist);
    const pinkyBaseToWristDist = distance3D(pinkyBase, wrist);
    
    // Các ngón tay mở khi khoảng cách từ đầu ngón đến cổ tay lớn hơn khoảng cách từ gốc ngón đến cổ tay
    const thumbOpen = thumbToWristDist > thumbBaseToWristDist * 1.2;
    const indexOpen = indexToWristDist > indexBaseToWristDist * 1.3;
    const middleOpen = middleToWristDist > middleBaseToWristDist * 1.3;
    const ringOpen = ringToWristDist > ringBaseToWristDist * 1.3;
    const pinkyOpen = pinkyToWristDist > pinkyBaseToWristDist * 1.3;
    
    // Hi-five khi tất cả 5 ngón đều mở
    return thumbOpen && indexOpen && middleOpen && ringOpen && pinkyOpen;
  }
  
  // Hàm tính khoảng cách giữa 2 điểm 3D
  const distance3D = (a: {x: number, y: number, z: number}, b: {x: number, y: number, z: number}): number => {
    return Math.sqrt(
      Math.pow(a.x - b.x, 2) + 
      Math.pow(a.y - b.y, 2) + 
      Math.pow(a.z - b.z, 2)
    );
  }

  // Dừng camera
  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
      setIsStreaming(false);
    }
    
    if (cameraRef.current) {
      cameraRef.current.stop();
      cameraRef.current = null;
    }
  }

  // Vẽ video frame lên canvas (fallback nếu MediaPipe không hoạt động)
  const drawVideoFrame = () => {
    if (videoRef.current && canvasRef.current && isStreaming) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      const video = videoRef.current;

      try {
        if (ctx && video.readyState === video.HAVE_ENOUGH_DATA) {
          // Make sure dimensions match
          canvas.width = 640;
          canvas.height = 480;
          
          // Vẽ video (mirror effect)
          ctx.save();
          ctx.scale(-1, 1);
          ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
          ctx.restore();

          // Vẽ bàn phím ảo
          drawVirtualKeyboard(ctx);
          
          console.log("Frame drawn to canvas");
        } else if (video.readyState !== video.HAVE_ENOUGH_DATA) {
          console.log("Waiting for video data...");
        }
      } catch (error) {
        console.error("Error drawing video frame:", error);
      }

      requestAnimationFrame(drawVideoFrame);
    }
  }
  
  // Xác định phím tại vị trí x, y
  const getKeyAtPosition = (x: number, y: number): string | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    
    const width = canvas.width;
    const height = canvas.height;
    
    // Vị trí bàn phím trên canvas
    const keyboardStartY = height * 0.45;
    const keyboardHeight = height * 0.5;
    const rowCount = KEYBOARD_LAYOUT.length;
    
    // Nếu vị trí nằm ngoài vùng bàn phím
    if (y < keyboardStartY || y > keyboardStartY + keyboardHeight) {
      return null;
    }
    
    // Xác định hàng
    const rowIndex = Math.floor((y - keyboardStartY) / (keyboardHeight / rowCount));
    if (rowIndex < 0 || rowIndex >= KEYBOARD_LAYOUT.length) {
      return null;
    }
    
    const row = KEYBOARD_LAYOUT[rowIndex];
    const rowY = keyboardStartY + (rowIndex + 0.5) * (keyboardHeight / rowCount);
    const keyCount = row.length;
    
    // Xác định phím trong hàng
    for (let keyIndex = 0; keyIndex < row.length; keyIndex++) {
      const key = row[keyIndex];
      const keyWidth = key === "SPACE" ? width * 0.4 : width / (keyCount + 2);
      const keyX = (width - (keyCount * keyWidth)) / 2 + keyIndex * keyWidth + keyWidth/2;
      const keyHeight = keyboardHeight / rowCount * 0.7;
      
      // Kiểm tra xem vị trí có nằm trong phạm vi của phím không
      if (key === "SPACE" || key === "BACKSPACE") {
        // Kiểm tra hình chữ nhật
        const left = keyX - keyWidth/2;
        const right = keyX + keyWidth/2;
        const top = rowY - keyHeight/2;
        const bottom = rowY + keyHeight/2;
        
        if (x >= left && x <= right && y >= top && y <= bottom) {
          return key;
        }
      } else {
        // Kiểm tra hình tròn
        const distance = Math.sqrt(Math.pow(x - keyX, 2) + Math.pow(y - rowY, 2));
        if (distance <= keyHeight/2) {
          return key;
        }
      }
    }
    
    return null;
  }

  // Toggle between direct video and canvas
  const toggleVideoMode = () => {
    setUseDirectVideo(prev => !prev);
    console.log("Switching to", useDirectVideo ? "canvas mode" : "direct video mode");
  }
  
  // Toggle showing hand landmarks
  const toggleLandmarks = () => {
    setShowLandmarks(prev => !prev);
  }

  // Vẽ bàn phím ảo trực tiếp trên camera
  const drawVirtualKeyboard = (ctx: CanvasRenderingContext2D) => {
    const canvas = ctx.canvas;
    const width = canvas.width;
    const height = canvas.height;
    
    // Đặt bàn phím ở nửa dưới của camera
    const keyboardStartY = height * 0.45;
    const keyboardHeight = height * 0.5;
    const rowCount = KEYBOARD_LAYOUT.length;
    
    // Vẽ nền bàn phím bán trong suốt
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.fillRect(0, keyboardStartY, width, keyboardHeight);
    
    // Thiết lập font cho phím
    ctx.font = "bold 20px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    
    // Vẽ từng hàng phím
    KEYBOARD_LAYOUT.forEach((row, rowIndex) => {
      const rowY = keyboardStartY + (rowIndex + 0.5) * (keyboardHeight / rowCount);
      const keyCount = row.length;
      
      // Vẽ từng phím trong hàng
      row.forEach((key, keyIndex) => {
        const keyWidth = key === "SPACE" ? width * 0.4 : width / (keyCount + 2);
        const keyX = (width - (keyCount * keyWidth)) / 2 + keyIndex * keyWidth + keyWidth/2;
        const keyHeight = keyboardHeight / rowCount * 0.7;
        const keyY = rowY;
        
        // Vẽ nền phím
        const isSelected = key === selectedKey;
        const isHovered = key === hoveredKey;
        
        // Màu nền phím tùy theo trạng thái
        ctx.fillStyle = isSelected ? "#3b82f6" : 
                       isHovered ? "rgba(255, 255, 255, 0.5)" :
                       "rgba(255, 255, 255, 0.2)";
        
        // Phím space rộng hơn
        if (key === "SPACE") {
          ctx.fillRect(keyX - keyWidth/2, keyY - keyHeight/2, keyWidth, keyHeight);
          ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
          ctx.strokeRect(keyX - keyWidth/2, keyY - keyHeight/2, keyWidth, keyHeight);
        } else if (key === "BACKSPACE") {
          ctx.fillRect(keyX - keyWidth/2, keyY - keyHeight/2, keyWidth, keyHeight);
          ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
          ctx.strokeRect(keyX - keyWidth/2, keyY - keyHeight/2, keyWidth, keyHeight);
        } else {
          // Phím thường là hình tròn
          ctx.beginPath();
          ctx.arc(keyX, keyY, keyHeight/2, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
          ctx.stroke();
        }
        
        // Vẽ text phím
        ctx.fillStyle = isSelected || isHovered ? "white" : "white";
        if (key === "SPACE") {
          ctx.fillText("SPACE", keyX, keyY);
        } else if (key === "BACKSPACE") {
          ctx.fillText("⌫", keyX, keyY);
        } else {
          ctx.fillText(key, keyX, keyY);
        }
      });
    });
  }

  // Mô phỏng nhận diện cử chỉ (demo) - Chỉ vào ký tự
  const simulateGestureDetection = () => {
    // Chọn ngẫu nhiên 1 phím từ bàn phím để mô phỏng
    const rows = KEYBOARD_LAYOUT;
    const randomRowIndex = Math.floor(Math.random() * rows.length);
    const randomRow = rows[randomRowIndex];
    const randomKeyIndex = Math.floor(Math.random() * randomRow.length);
    const randomKey = randomRow[randomKeyIndex];
    
    // Highlight phím được chọn
    setSelectedKey(randomKey);
    setGestureDetected(true);
    
    // Sau 1 giây, "nhấn" phím đó
    setTimeout(() => {
      handleKeyPress(randomKey);
      setGestureDetected(false);
    }, 1000);
  }

  // Xử lý gõ phím khi phát hiện cử chỉ
  const handleKeyPress = (key: string) => {
    if (isProcessing) return;

    setIsProcessing(true);
    setSelectedKey(key);

    // Phát âm thanh (optional)
    playKeySound();

    setTimeout(() => {
      if (key === "SPACE") {
        setText((prev) => prev + " ");
        // Reset trạng thái từ mới
        setCurrentWord("");
        setLastChar(null);
      } else if (key === "BACKSPACE") {
        setText((prev) => {
          const newText = prev.slice(0, -1);
          
          // Cập nhật currentWord khi xóa
          const lastSpaceIndex = newText.lastIndexOf(" ");
          const newWord = lastSpaceIndex === -1 ? newText : newText.slice(lastSpaceIndex + 1);
          setCurrentWord(newWord);
          
          // Cập nhật ký tự cuối cùng
          if (newWord.length > 0) {
            const lastCh = newWord[newWord.length - 1];
            // Kiểm tra xem ký tự cuối cùng có lặp lại không
            if (newWord.length > 1 && newWord[newWord.length - 2] === lastCh) {
              let count = 1;
              for (let i = newWord.length - 1; i >= 0; i--) {
                if (newWord[i] === lastCh) {
                  count++;
                } else {
                  break;
                }
              }
              setLastChar({ char: lastCh, count });
            } else {
              setLastChar({ char: lastCh, count: 1 });
            }
          } else {
            setLastChar(null);
          }
          
          return newText;
        });
      } else {
        // Chuyển đổi key thành ký tự cần thêm
        const charToAdd = key.toLowerCase();
        
        // Kiểm tra xem có nên loại bỏ ký tự trùng lặp liên tiếp không
        let shouldAddChar = true;
        
        if (noRepeatedChars && lastChar && lastChar.char === charToAdd) {
          shouldAddChar = false; // Không thêm ký tự lặp lại liên tiếp
        }
        
        if (shouldAddChar) {
          // Xử lý kiểu gõ tiếng Việt nếu cần
          const processedText = processVietnameseInput(currentWord, charToAdd);
          
          // Cập nhật text và currentWord
          if (processedText.replaced) {
            // Nếu có thay thế (vd: "a" + "a" -> "â")
            setText((prev) => {
              const lastWordStart = prev.lastIndexOf(" ") + 1;
              return prev.substring(0, lastWordStart) + processedText.result;
            });
          } else {
            // Nếu chỉ thêm ký tự bình thường
            setText((prev) => prev + charToAdd);
          }
          
          // Cập nhật từ hiện tại
          setCurrentWord(processedText.result);
          
          // Cập nhật ký tự cuối cùng
          if (processedText.replaced) {
            // Nếu đã thay thế, cập nhật ký tự cuối mới
            const lastCh = processedText.result[processedText.result.length - 1];
            setLastChar({ char: lastCh, count: 1 }); 
          } else {
            // Nếu là ký tự mới
            setLastChar({ char: charToAdd, count: 1 });
          }
        } else {
          console.log(`Blocking repeated character: ${charToAdd}`);
          // Có thể thêm phản hồi cho người dùng biết ký tự đã bị chặn
        }
      }

      setSelectedKey(null);
      setIsProcessing(false);
    }, 200);
  };

  // Phát âm thanh khi gõ phím
  const playKeySound = () => {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
    const oscillator = audioContext.createOscillator()
    const gainNode = audioContext.createGain()

    oscillator.connect(gainNode)
    gainNode.connect(audioContext.destination)

    oscillator.frequency.value = 800
    oscillator.type = "sine"
    gainNode.gain.setValueAtTime(0.1, audioContext.currentTime)
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1)

    oscillator.start(audioContext.currentTime)
    oscillator.stop(audioContext.currentTime + 0.1)
  }

  // Toggle chế độ loại bỏ ký tự lặp lại
  const toggleNoRepeatedChars = () => {
    setNoRepeatedChars(prev => !prev);
  };
  
  // Xử lý gõ tiếng Việt
  const processVietnameseInput = (word: string, newChar: string): { result: string, replaced: boolean } => {
    if (inputMode === "NORMAL") {
      return { result: word + newChar, replaced: false };
    }
    
    // Nếu từ trống, chỉ cần thêm ký tự mới
    if (!word) {
      return { result: newChar, replaced: false };
    }
    
    // Xử lý Telex
    if (inputMode === "TELEX") {
      const vowels = "aeiouy";
      const lastCh = word[word.length - 1].toLowerCase();
      
      // Xử lý dấu thanh
      if (newChar === "s") { // dấu sắc
        if (vowels.includes(lastCh)) {
          const accentMap: {[key: string]: string} = {
            "a": "á", "e": "é", "i": "í", "o": "ó", "u": "ú", "y": "ý"
          };
          if (accentMap[lastCh]) {
            return {
              result: word.slice(0, -1) + accentMap[lastCh],
              replaced: true
            };
          }
        }
      }
      else if (newChar === "f") { // dấu huyền
        if (vowels.includes(lastCh)) {
          const accentMap: {[key: string]: string} = {
            "a": "à", "e": "è", "i": "ì", "o": "ò", "u": "ù", "y": "ỳ"
          };
          if (accentMap[lastCh]) {
            return {
              result: word.slice(0, -1) + accentMap[lastCh],
              replaced: true
            };
          }
        }
      }
      else if (newChar === "r") { // dấu hỏi
        if (vowels.includes(lastCh)) {
          const accentMap: {[key: string]: string} = {
            "a": "ả", "e": "ẻ", "i": "ỉ", "o": "ỏ", "u": "ủ", "y": "ỷ"
          };
          if (accentMap[lastCh]) {
            return {
              result: word.slice(0, -1) + accentMap[lastCh],
              replaced: true
            };
          }
        }
      }
      else if (newChar === "x") { // dấu ngã
        if (vowels.includes(lastCh)) {
          const accentMap: {[key: string]: string} = {
            "a": "ã", "e": "ẽ", "i": "ĩ", "o": "õ", "u": "ũ", "y": "ỹ"
          };
          if (accentMap[lastCh]) {
            return {
              result: word.slice(0, -1) + accentMap[lastCh],
              replaced: true
            };
          }
        }
      }
      else if (newChar === "j") { // dấu nặng
        if (vowels.includes(lastCh)) {
          const accentMap: {[key: string]: string} = {
            "a": "ạ", "e": "ẹ", "i": "ị", "o": "ọ", "u": "ụ", "y": "ỵ"
          };
          if (accentMap[lastCh]) {
            return {
              result: word.slice(0, -1) + accentMap[lastCh],
              replaced: true
            };
          }
        }
      }
      
      // Xử lý chữ ă, â, ê, ô, ơ, ư, đ
      if (lastCh === "a" && newChar === "a") {
        return {
          result: word.slice(0, -1) + "â",
          replaced: true
        };
      }
      else if (lastCh === "a" && newChar === "w") {
        return {
          result: word.slice(0, -1) + "ă",
          replaced: true
        };
      }
      else if (lastCh === "e" && newChar === "e") {
        return {
          result: word.slice(0, -1) + "ê",
          replaced: true
        };
      }
      else if (lastCh === "o" && newChar === "o") {
        return {
          result: word.slice(0, -1) + "ô",
          replaced: true
        };
      }
      else if (lastCh === "o" && newChar === "w") {
        return {
          result: word.slice(0, -1) + "ơ",
          replaced: true
        };
      }
      else if (lastCh === "u" && newChar === "w") {
        return {
          result: word.slice(0, -1) + "ư",
          replaced: true
        };
      }
      else if (lastCh === "d" && newChar === "d") {
        return {
          result: word.slice(0, -1) + "đ",
          replaced: true
        };
      }
    }
    // Xử lý VNI
    else if (inputMode === "VNI") {
      const vowels = "aeiouy";
      const lastCh = word[word.length - 1].toLowerCase();
      
      // Xử lý dấu thanh
      if (newChar === "1") { // dấu sắc
        if (vowels.includes(lastCh)) {
          const accentMap: {[key: string]: string} = {
            "a": "á", "e": "é", "i": "í", "o": "ó", "u": "ú", "y": "ý"
          };
          if (accentMap[lastCh]) {
            return {
              result: word.slice(0, -1) + accentMap[lastCh],
              replaced: true
            };
          }
        }
      }
      else if (newChar === "2") { // dấu huyền
        if (vowels.includes(lastCh)) {
          const accentMap: {[key: string]: string} = {
            "a": "à", "e": "è", "i": "ì", "o": "ò", "u": "ù", "y": "ỳ"
          };
          if (accentMap[lastCh]) {
            return {
              result: word.slice(0, -1) + accentMap[lastCh],
              replaced: true
            };
          }
        }
      }
      else if (newChar === "3") { // dấu hỏi
        if (vowels.includes(lastCh)) {
          const accentMap: {[key: string]: string} = {
            "a": "ả", "e": "ẻ", "i": "ỉ", "o": "ỏ", "u": "ủ", "y": "ỷ"
          };
          if (accentMap[lastCh]) {
            return {
              result: word.slice(0, -1) + accentMap[lastCh],
              replaced: true
            };
          }
        }
      }
      else if (newChar === "4") { // dấu ngã
        if (vowels.includes(lastCh)) {
          const accentMap: {[key: string]: string} = {
            "a": "ã", "e": "ẽ", "i": "ĩ", "o": "õ", "u": "ũ", "y": "ỹ"
          };
          if (accentMap[lastCh]) {
            return {
              result: word.slice(0, -1) + accentMap[lastCh],
              replaced: true
            };
          }
        }
      }
      else if (newChar === "5") { // dấu nặng
        if (vowels.includes(lastCh)) {
          const accentMap: {[key: string]: string} = {
            "a": "ạ", "e": "ẹ", "i": "ị", "o": "ọ", "u": "ụ", "y": "ỵ"
          };
          if (accentMap[lastCh]) {
            return {
              result: word.slice(0, -1) + accentMap[lastCh],
              replaced: true
            };
          }
        }
      }
      
      // Xử lý chữ ă, â, ê, ô, ơ, ư, đ
      if (lastCh === "a" && newChar === "6") {
        return {
          result: word.slice(0, -1) + "â",
          replaced: true
        };
      }
      else if (lastCh === "a" && newChar === "8") {
        return {
          result: word.slice(0, -1) + "ă",
          replaced: true
        };
      }
      else if (lastCh === "e" && newChar === "6") {
        return {
          result: word.slice(0, -1) + "ê",
          replaced: true
        };
      }
      else if (lastCh === "o" && newChar === "6") {
        return {
          result: word.slice(0, -1) + "ô",
          replaced: true
        };
      }
      else if (lastCh === "o" && newChar === "7") {
        return {
          result: word.slice(0, -1) + "ơ",
          replaced: true
        };
      }
      else if (lastCh === "u" && newChar === "7") {
        return {
          result: word.slice(0, -1) + "ư",
          replaced: true
        };
      }
      else if (lastCh === "d" && newChar === "9") {
        return {
          result: word.slice(0, -1) + "đ",
          replaced: true
        };
      }
    }
    
    // Nếu không có quy tắc đặc biệt, thêm ký tự bình thường
    return { result: word + newChar, replaced: false };
  };

  // Toggle kiểu gõ tiếng Việt
  const toggleInputMode = () => {
    setInputMode(prevMode => {
      switch (prevMode) {
        case "NORMAL": return "TELEX";
        case "TELEX": return "VNI";
        case "VNI": return "NORMAL";
        default: return "NORMAL";
      }
    });
  };

  // Check camera availability on component mount
  useEffect(() => {
    checkCameraAvailability();
  }, []);
  
  // Cleanup khi component unmount
  useEffect(() => {
    return () => {
      stopCamera();
    }
  }, []);
  
  const cleanRepeatedChars = (text: string) => {
    if (!text) return "";
    
    // Xử lý các ký tự lặp lại liên tiếp
    let result = text[0]; // Bắt đầu với ký tự đầu tiên
    let currentChar = text[0];
    
    for (let i = 1; i < text.length; i++) {
      // Nếu ký tự hiện tại khác ký tự trước đó, thêm vào kết quả
      if (text[i] !== currentChar) {
        result += text[i];
        currentChar = text[i];
      }
      // Nếu giống nhau, bỏ qua không thêm vào
    }
    
    return result;
  };

  // Xử lý văn bản đầu vào để loại bỏ các ký tự lặp lại
  const handleTextClean = () => {
    // Tách văn bản thành các từ
    const words = text.split(" ");
    
    // Xử lý từng từ để loại bỏ ký tự lặp lại
    const cleanedWords = words.map(word => cleanRepeatedChars(word));
    
    // Ghép lại và cập nhật
    const cleanedText = cleanedWords.join(" ");
    setText(cleanedText);
    
    // Cập nhật từ hiện tại
    const lastSpaceIndex = cleanedText.lastIndexOf(" ");
    const newWord = lastSpaceIndex === -1 ? cleanedText : cleanedText.slice(lastSpaceIndex + 1);
    setCurrentWord(newWord);
    
    if (newWord) {
      setLastChar({ char: newWord[newWord.length - 1], count: 1 });
    } else {
      setLastChar(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <Card>
          <CardHeader>
            <CardTitle className="text-center text-2xl font-bold text-gray-800">🤚 Bàn Phím Cử Chỉ Tay</CardTitle>
            <p className="text-center text-gray-600">Sử dụng cử chỉ tay để gõ phím thông qua camera</p>
          </CardHeader>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Camera Section - mở rộng */}
          <Card className="lg:col-span-8">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Camera className="w-5 h-5" />
                Camera & Nhận Diện Cử Chỉ
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative w-full" style={{ minHeight: "500px" }}>
                {/* Video element - can be shown directly or used as source for canvas */}
                <video 
                  ref={videoRef} 
                  autoPlay 
                  playsInline 
                  muted
                  className={`w-full mx-auto rounded-lg ${useDirectVideo ? 'block' : 'hidden'}`}
                />
                
                {/* Canvas for effects and tracking visualization */}
                <canvas
                  ref={canvasRef}
                  width={640}
                  height={480}
                  className={`w-full mx-auto border-2 border-gray-300 rounded-lg bg-black ${useDirectVideo ? 'hidden' : 'block'}`}
                />

                {!isStreaming && (
                  <div className="absolute inset-0 flex items-center justify-center bg-gray-100 rounded-lg">
                    <div className="text-center">
                      <Camera className="w-12 h-12 mx-auto text-gray-400 mb-2" />
                      <p className="text-gray-500">
                        {hasCameraDevices === null ? "Đang kiểm tra camera..." : 
                         hasCameraDevices === false ? "Không tìm thấy thiết bị camera" : 
                         "Camera chưa được bật"}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-2 justify-center">
                <Button
                  onClick={isStreaming ? stopCamera : startCamera}
                  variant={isStreaming ? "destructive" : "default"}
                  className="flex items-center gap-2"
                  disabled={hasCameraDevices === false}
                >
                  {isStreaming ? (
                    <>
                      <CameraOff className="w-4 h-4" />
                      Tắt Camera
                    </>
                  ) : (
                    <>
                      <Camera className="w-4 h-4" />
                      Bật Camera
                    </>
                  )}
                </Button>

                <Button 
                  onClick={simulateGestureDetection} 
                  variant="outline" 
                  disabled={!isStreaming}
                >
                  Demo Cử Chỉ
                </Button>
                
                <Button
                  onClick={toggleLandmarks}
                  variant="outline"
                  disabled={!isStreaming}
                >
                  {showLandmarks ? "Ẩn Điểm Tay" : "Hiện Điểm Tay"}
                </Button>
                
                <Button
                  onClick={toggleInputMode}
                  variant="outline"
                >
                  Kiểu gõ: {inputMode}
                </Button>
                
                <Button
                  onClick={toggleNoRepeatedChars}
                  variant={noRepeatedChars ? "secondary" : "outline"}
                >
                  {noRepeatedChars ? "Bỏ ký tự lặp lại" : "Cho phép lặp lại ký tự"}
                </Button>

                <Button 
                  onClick={handleTextClean} 
                  variant="outline"
                >
                  Xử lý văn bản hiện tại
                </Button>
                
                {isStreaming && (
                  <Button
                    onClick={toggleVideoMode}
                    variant="outline"
                  >
                    {useDirectVideo ? "Hiển thị Canvas" : "Hiển thị Video"}
                  </Button>
                )}
                
                <Button
                  onClick={restartCamera}
                  variant="secondary"
                  className="flex items-center gap-2"
                >
                  <RotateCcw className="w-4 h-4" />
                  Khởi động lại Camera
                </Button>
              </div>
              
              {/* Camera status and debug information */}
              {!isStreaming && hasCameraDevices && (
                <div className="bg-blue-50 p-3 rounded-lg">
                  <p className="text-blue-800 font-medium">Gợi ý khắc phục sự cố:</p>
                  <ul className="text-sm text-blue-700 space-y-1 mt-2">
                    <li>• Đảm bảo không có ứng dụng nào đang sử dụng camera</li>
                    <li>• Kiểm tra quyền truy cập camera trong cài đặt trình duyệt</li>
                    <li>• Thử tải lại trang và cấp quyền khi được hỏi</li>
                    <li>• Kiểm tra xem camera có bị tắt bởi công tắc vật lý không</li>
                  </ul>
                </div>
              )}
              
              {/* Check camera availability */}
              {hasCameraDevices === false && (
                <div className="bg-yellow-50 p-3 rounded-lg">
                  <p className="text-yellow-800 font-medium">Không tìm thấy thiết bị camera</p>
                  <p className="text-yellow-700 text-sm mt-1">Vui lòng kết nối camera và refresh trang này.</p>
                </div>
              )}

              {/* Hướng dẫn */}
              <div className="bg-blue-50 p-3 rounded-lg">
                <h4 className="font-semibold text-blue-800 mb-2">Hướng dẫn:</h4>
                <ul className="text-sm text-blue-700 space-y-1">
                  <li>• Đưa tay vào vùng nhìn của camera</li>
                  <li>• Di chuyển <strong>ngón cái</strong> đến phím muốn chọn</li>
                  <li>• Giơ cả 5 ngón tay (hi-five) để "nhấn" phím</li>
                  <li>• Các ký tự lặp lại liên tiếp sẽ được tự động loại bỏ</li>
                  <li>• Nhấn Space để bắt đầu từ mới</li>
                </ul>
              </div>
            </CardContent>
          </Card>

          {/* Text Output */}
          <Card className="lg:col-span-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 justify-between">
                <div className="flex items-center gap-2">
                  <Volume2 className="w-5 h-5" />
                  Kết Quả Gõ Phím
                </div>
                <div className="text-sm font-normal bg-blue-100 text-blue-700 px-2 py-1 rounded">
                  {inputMode === "NORMAL" ? "Tiếng Anh" : 
                   inputMode === "TELEX" ? "Tiếng Việt (TELEX)" : 
                   "Tiếng Việt (VNI)"}
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  // Cập nhật currentWord khi thay đổi text trực tiếp
                  const lastSpaceIndex = e.target.value.lastIndexOf(" ");
                  const word = lastSpaceIndex === -1 ? e.target.value : e.target.value.slice(lastSpaceIndex + 1);
                  setCurrentWord(word);
                  
                  // Cập nhật ký tự cuối cùng
                  if (word.length > 0) {
                    setLastChar({ char: word[word.length - 1], count: 1 });
                  } else {
                    setLastChar(null);
                  }
                }}
                placeholder="Văn bản sẽ xuất hiện ở đây khi bạn gõ phím bằng cử chỉ tay..."
                className="min-h-[200px] text-lg"
              />

              <div className="flex gap-2">
                <Button onClick={() => {
                  setText("");
                  setCurrentWord("");
                  setLastChar(null);
                }} variant="outline" className="flex items-center gap-2">
                  <RotateCcw className="w-4 h-4" />
                  Xóa Tất Cả
                </Button>

                <Button onClick={() => navigator.clipboard.writeText(text)} variant="outline" disabled={!text}>
                  Sao Chép
                </Button>
              </div>

              {/* Thông tin về kiểu gõ */}
              <div className="bg-gray-50 p-3 rounded-lg">
                <h4 className="font-semibold text-gray-700 mb-2">Kiểu gõ: {inputMode}</h4>
                {inputMode === "TELEX" && (
                  <div className="text-xs text-gray-600 space-y-1">
                    <p>• Dấu: <span className="font-semibold">s</span> (sắc), <span className="font-semibold">f</span> (huyền), <span className="font-semibold">r</span> (hỏi), <span className="font-semibold">x</span> (ngã), <span className="font-semibold">j</span> (nặng)</p>
                    <p>• aa → â, aw → ă, ee → ê, oo → ô, ow → ơ, uw → ư, dd → đ</p>
                  </div>
                )}
                {inputMode === "VNI" && (
                  <div className="text-xs text-gray-600 space-y-1">
                    <p>• Dấu: <span className="font-semibold">1</span> (sắc), <span className="font-semibold">2</span> (huyền), <span className="font-semibold">3</span> (hỏi), <span className="font-semibold">4</span> (ngã), <span className="font-semibold">5</span> (nặng)</p>
                    <p>• a6 → â, a8 → ă, e6 → ê, o6 → ô, o7 → ơ, u7 → ư, d9 → đ</p>
                  </div>
                )}
              </div>

              {/* Thống kê */}
              <div className="bg-gray-50 p-3 rounded-lg">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-600">Số ký tự:</span>
                    <span className="ml-2 font-semibold">{text.length}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Số từ:</span>
                    <span className="ml-2 font-semibold">{text.trim() ? text.trim().split(/\s+/).length : 0}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-gray-600">Từ hiện tại:</span>
                    <span className="ml-2 font-medium">{currentWord}</span>
                    {lastChar && noRepeatedChars && (
                      <div className="mt-1">
                        <span className="text-xs text-gray-500">Ký tự cuối: </span>
                        <span className="text-xs font-medium text-orange-500">
                          {lastChar.char}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
